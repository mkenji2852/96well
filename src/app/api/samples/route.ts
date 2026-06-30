import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { createSampleSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "sample:read");
    const samples = await prisma.sample.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { plates: { select: { id: true, name: true, status: true } } },
    });
    return NextResponse.json({ samples });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "処理に失敗しました。" } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "sample:create");
    const parsed = createSampleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const sample = await tx.sample.create({
        data: {
          organizationId: actor.organizationId,
          createdByUserId: actor.userId,
          sampleCode: parsed.data.sampleCode,
          organism: parsed.data.organism || null,
          notes: parsed.data.notes || null,
          plates: {
            create: {
              organizationId: actor.organizationId,
              name: `${parsed.data.sampleCode} Plate 1`,
              drugs: {
                create: parsed.data.drugs.map((drug, rowIndex) => ({
                  rowIndex,
                  drugName: drug.drugName,
                  unit: drug.unit,
                  concentrations: drug.concentrations,
                })),
              },
            },
          },
        },
        include: { plates: { include: { drugs: true } } },
      });

      const plate = sample.plates[0];
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "SAMPLE_CREATED",
          entityType: "Sample",
          entityId: sample.id,
          afterJson: {
            sampleCode: sample.sampleCode,
            plateId: plate.id,
            organizationId: actor.organizationId,
            sessionId: actor.sessionId,
          },
        },
      });
      return { sample, plate };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "SAMPLE_CODE_EXISTS" }, { status: 409 });
    }
    console.error(error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "処理に失敗しました。" } }, { status: 500 });
  }
}
