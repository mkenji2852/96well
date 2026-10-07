import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { flexibleConcentrations } from "@/lib/drug-layout";
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
  const requestDebugId = crypto.randomUUID();
  let stage = "authentication";
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "sample:create");
    stage = "validation";
    const parsed = createSampleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
    }

    stage = "transaction-start";
    const result = await prisma.$transaction(async (tx) => {
      stage = "create-sample-plate";
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
              name: parsed.data.plateName || `${parsed.data.sampleCode} Plate 1`,
              drugs: {
                createMany: { data: parsed.data.drugs.map((drug, fallbackRowIndex) => {
                  const concentrations = (drug.wells
                    ? flexibleConcentrations(drug.wells)
                    : drug.concentrations ?? []) as Prisma.InputJsonValue;
                  return {
                    rowIndex: drug.rowIndex ?? fallbackRowIndex,
                    drugName: drug.drugName,
                    unit: drug.unit,
                    concentrations,
                  };
                }) },
              },
            },
          },
        },
        include: { plates: { include: { drugs: true } } },
      });

      const plate = sample.plates[0];
      stage = "create-audit";
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
    }, { maxWait: 5000, timeout: 20000 });

    stage = "response";
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "SAMPLE_CODE_EXISTS" }, { status: 409 });
    }
    const errorCode = typeof error === "object" && error !== null && "code" in error
      && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : null;
    // Inspect only for a known constraint; never expose the underlying DB message.
    const databaseError = (error as { meta?: { database_error?: unknown } } | null)?.meta?.database_error;
    const layoutConstraint = typeof databaseError === "string" && databaseError.includes("PlateDrug_row_range_check");
    console.error({
      event: "SAMPLE_CREATION_FAILED", route: "POST /api/samples",
      requestDebugId, stage, errorCode,
      ...(layoutConstraint ? { constraint: "PlateDrug_row_range_check" } : {}),
    });
    const message = layoutConstraint
      ? "DBの薬剤配置制約が旧形式です。管理者に柔軟な薬剤配置用migrationの適用を依頼してください。"
      : errorCode === "P2028"
      ? "作成処理が時間内に完了しませんでした。Sample一覧を確認してから再度お試しください。"
      : "Sample／プレートの作成に失敗しました。管理者へ問い合わせ用IDをお伝えください。";
    return NextResponse.json({ error: {
      code: layoutConstraint ? "PLATE_LAYOUT_DATABASE_OUTDATED" : "INTERNAL_ERROR",
      message: `${message}（問い合わせ用ID: ${requestDebugId}）`, requestDebugId,
    } }, { status: 500 });
  }
}
