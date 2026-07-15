import { pathToFileURL } from "node:url";
import { PrismaClient, type Role } from "@prisma/client";
import { requirePostgresUrl } from "./postgres-utils";

const DEFAULT_ORGANIZATION_NAME = "96well Research Preview";
const VALID_ROLES = new Set<Role>(["TECHNICIAN", "REVIEWER", "ADMIN", "AUDITOR"]);

interface InviteOptions {
  email: string;
  role: Role;
  organizationId?: string;
  organizationName: string;
  expiresAt?: Date;
  createdByUserId?: string;
  force: boolean;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("--email must be a valid email-like value.");
  }
  return email;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function parseArgs(argv: string[]): InviteOptions {
  const email = normalizeEmail(readOption(argv, "--email") ?? "");
  const roleValue = (readOption(argv, "--role") ?? "TECHNICIAN").trim().toUpperCase() as Role;
  if (!VALID_ROLES.has(roleValue)) {
    throw new Error(`--role must be one of ${Array.from(VALID_ROLES).join(", ")}.`);
  }
  const expiresAtValue = readOption(argv, "--expires-at");
  const expiresAt = expiresAtValue ? new Date(expiresAtValue) : undefined;
  if (expiresAtValue && Number.isNaN(expiresAt?.getTime())) {
    throw new Error("--expires-at must be an ISO date/time.");
  }
  return {
    email,
    role: roleValue,
    organizationId: readOption(argv, "--organization-id"),
    organizationName: readOption(argv, "--organization-name")?.trim() || DEFAULT_ORGANIZATION_NAME,
    expiresAt,
    createdByUserId: readOption(argv, "--created-by-user-id"),
    force: argv.includes("--force"),
  };
}

async function resolveOrganization(prisma: PrismaClient, options: InviteOptions): Promise<string> {
  if (options.organizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: options.organizationId },
      select: { id: true },
    });
    if (!organization) throw new Error("Specified organizationId was not found.");
    return organization.id;
  }

  const existing = await prisma.organization.findFirst({
    where: { name: options.organizationName },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.id;

  const created = await prisma.organization.create({
    data: { name: options.organizationName },
    select: { id: true },
  });
  return created.id;
}

export async function upsertResearchPublicInvite(
  prisma: PrismaClient,
  options: InviteOptions,
): Promise<{ inviteId: string; organizationId: string; email: string; role: Role; status: "created" | "updated" }> {
  const organizationId = await resolveOrganization(prisma, options);
  const existing = await prisma.userInvite.findUnique({
    where: { organizationId_email: { organizationId, email: options.email } },
    select: { id: true, redeemedAt: true },
  });

  if (existing?.redeemedAt) {
    throw new Error(
      "Invite has already been redeemed. Refusing to clear redeemedAt or reuse it; create a new controlled account flow instead.",
    );
  }

  if (existing) {
    const updated = await prisma.userInvite.update({
      where: { id: existing.id },
      data: {
        role: options.role,
        active: true,
        expiresAt: options.expiresAt,
        createdByUserId: options.createdByUserId,
      },
      select: { id: true, organizationId: true, email: true, role: true },
    });
    return { inviteId: updated.id, organizationId: updated.organizationId, email: updated.email, role: updated.role, status: "updated" };
  }

  const created = await prisma.userInvite.create({
    data: {
      organizationId,
      email: options.email,
      role: options.role,
      active: true,
      expiresAt: options.expiresAt,
      createdByUserId: options.createdByUserId,
    },
    select: { id: true, organizationId: true, email: true, role: true },
  });
  return { inviteId: created.id, organizationId: created.organizationId, email: created.email, role: created.role, status: "created" };
}

export async function runResearchPublicInvite(argv = process.argv.slice(2)): Promise<number> {
  let options: InviteOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid invite arguments.");
    console.error("Usage: pnpm preview:invite -- --email user@example.com --role TECHNICIAN [--organization-name \"96well Research Preview\"] [--organization-id org_id] [--expires-at 2026-08-01T00:00:00Z]");
    return 2;
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: requirePostgresUrl("POSTGRES_PRISMA_DATABASE_URL"),
      },
    },
  });

  try {
    const invite = await upsertResearchPublicInvite(prisma, options);
    console.log(JSON.stringify({
      status: "OK",
      action: invite.status,
      invite: {
        id: invite.inviteId,
        organizationId: invite.organizationId,
        email: invite.email,
        role: invite.role,
        active: true,
      },
      safety: {
        emailNormalized: true,
        redeemedInviteReuse: "refused",
        runtimeCredentialUsed: false,
      },
    }, null, 2));
    if (options.role === "ADMIN") {
      console.warn("ADMIN invite created only because --role ADMIN was explicitly requested.");
    }
    if (options.force) {
      console.warn("--force does not clear redeemedAt and does not reopen redeemed invites.");
    }
    return 0;
  } catch (error) {
    console.error(JSON.stringify({
      status: "ERROR",
      error: {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Invite creation failed.",
      },
    }, null, 2));
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runResearchPublicInvite().then((code) => {
    process.exitCode = code;
  });
}
