import { randomUUID, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireAuthenticatedUser, type AuthenticatedActor } from "@/lib/auth";
import { authErrorResponse, AuthError } from "@/lib/api-auth-error";
import { assertBreakpointContentHash, BreakpointLifecycleError } from "@/lib/breakpoint-lifecycle";
import { buildPopulationWorkbook, type ExportData } from "@/lib/excel";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { compareSampleCodes, withinSampleRange } from "@/lib/sample-range";

const schema = z.object({ from: z.string().trim().min(1).max(80), to: z.string().trim().min(1).max(80) }).strict();
class BatchExportError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

export async function POST(request: Request) {
  const exportId = randomUUID();
  let actor: AuthenticatedActor | null = null;
  const generatedAt = new Date();
  const audit = async (action: string, data: Record<string, unknown>) => {
    if (!actor) return;
    await prisma.auditLog.create({ data: { actorId: actor.userId, actorLabel: actor.userId, action,
      entityType: "ExportRecord", entityId: exportId,
      afterJson: { exportId, organizationId: actor.organizationId, profile: "ANONYMIZED", timestamp: new Date().toISOString(), ...data } as Prisma.InputJsonValue,
    } });
  };
  try {
    actor = await requireAuthenticatedUser(request);
    const currentActor = actor;
    requirePermission(actor, "export:anonymized");
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new BatchExportError("INVALID_RANGE", "Sample-IDの開始と終了を入力してください。");
    if (compareSampleCodes(parsed.data.from, parsed.data.to) > 0) throw new BatchExportError("INVALID_RANGE", "開始Sample-IDは終了Sample-ID以前にしてください。");
    await audit("EXPORT_REQUESTED", { range: parsed.data });
    const snapshots = await prisma.$transaction(async tx => {
      const candidates = await tx.sample.findMany({ where: { organizationId: currentActor.organizationId },
        select: { id: true, sampleCode: true }, take: 5001,
      });
      if (candidates.length > 5000) throw new BatchExportError("RANGE_SEARCH_LIMIT", "施設内のSample数が検索上限を超えています。管理者へお問い合わせください。");
      const selected = candidates.filter(sample => withinSampleRange(sample.sampleCode, parsed.data.from, parsed.data.to)).sort((a, b) => compareSampleCodes(a.sampleCode, b.sampleCode));
      if (!selected.length) throw new BatchExportError("NO_SAMPLES", "指定範囲にSampleがありません。", 404);
      if (selected.length > 50) throw new BatchExportError("EXPORT_LIMIT", "1回の出力は50 Sampleまでです。範囲を狭めてください。");
      const references = await tx.plate.findMany({ where: { organizationId: currentActor.organizationId, sampleId: { in: selected.map(sample => sample.id) } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1001, select: { id: true, sampleId: true },
      });
      if (references.length > 1000) throw new BatchExportError("EXPORT_LIMIT", "範囲内のプレート数が上限を超えています。範囲を狭めてください。");
      const latestIds = selected.map(sample => references.find(plate => plate.sampleId === sample.id)?.id).filter((id): id is string => Boolean(id));
      if (latestIds.length !== selected.length) throw new BatchExportError("SAMPLE_WITHOUT_PLATE", "プレートのないSampleが含まれています。対象範囲を確認してください。");
      const plates = await tx.plate.findMany({ where: { organizationId: currentActor.organizationId, id: { in: latestIds } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1001,
        include: { sample: true, drugs: { orderBy: { rowIndex: "asc" } }, wells: true,
          rawMics: { where: { status: "CURRENT" }, include: { plateDrug: true, interpretations: { where: { status: "CURRENT" } } } },
        },
      });
      const latest = selected.map(sample => plates.find(plate => plate.sampleId === sample.id)).filter((plate): plate is NonNullable<typeof plate> => Boolean(plate));
      if (latest.length !== selected.length) throw new BatchExportError("SAMPLE_WITHOUT_PLATE", "プレートのないSampleが含まれています。対象範囲を確認してください。");
      if (new Set(latest.flatMap(plate => plate.drugs.map(drug => JSON.stringify([drug.drugName, drug.unit])))).size > 200) throw new BatchExportError("EXPORT_LIMIT", "薬剤・単位の組合せは200件までです。範囲を狭めてください。");
      const setIds = [...new Set(latest.flatMap(plate => plate.rawMics.map(mic => mic.breakpointSetId)))];
      if (setIds.length > 1) throw new BatchExportError("MIXED_BREAKPOINT_SETS", "複数のBreakpointSetが含まれています。同じセットのSample範囲に分けて出力してください。", 409);
      const versions = new Set(latest.flatMap(plate => plate.rawMics.flatMap(mic => mic.interpretations.filter(sir => !(sir.category === "NO_BREAKPOINT" && sir.standard == null && sir.ruleVersion == null)).map(sir => JSON.stringify([sir.standard, sir.ruleVersion])))));
      if (versions.size > 1) throw new BatchExportError("MIXED_BREAKPOINT_VERSIONS", "Breakpoint標準／版が混在しています。同じ版の範囲に分けてください。", 409);
      const sets = await tx.breakpointSet.findMany({ where: { id: { in: setIds }, organizationId: currentActor.organizationId }, include: { rules: true } });
      if (sets.length !== setIds.length || sets.some(set => set.status !== "APPROVED" && set.status !== "RETIRED")) throw new BatchExportError("BREAKPOINT_SET_NOT_APPROVED", "承認済みのBreakpointSetだけを出力できます。", 409);
      for (const set of sets) assertBreakpointContentHash(set);
      return latest.map((plate): ExportData => {
        const set = sets.find(item => item.id === plate.rawMics[0]?.breakpointSetId);
        return { plate, auditLogs: [], metadata: {
          exportId, profile: "ANONYMIZED", generatedAt, pseudonymousSampleId: `AST-${randomUUID()}`,
          breakpointSetId: set?.id ?? null, breakpointStandard: set?.standard ?? null, breakpointVersion: set?.version ?? null,
          breakpointContentHash: set?.contentHash ?? null, breakpointStatus: set?.status ?? null,
          breakpointApprovedByUserId: set?.approvedByUserId ?? null, breakpointApprovedAt: set?.approvedAt ?? null, noBreakpointPolicy: "AS_BLANK",
          snapshot: { plateId: plate.id, plateRevision: plate.updatedAt.toISOString(), wellRevision: plate.wellRevision, resultRevision: plate.resultRevision,
            breakpointSetId: set?.id ?? null, rawMicIds: plate.rawMics.map(mic => mic.id), sirInterpretationIds: plate.rawMics.flatMap(mic => mic.interpretations.map(sir => sir.id)), imageReviewIds: [],
          },
        } };
      });
    }, { isolationLevel: "Serializable", maxWait: 5000, timeout: 20000 });
    const workbook = await buildPopulationWorkbook(snapshots);
    const checksumSha256 = createHash("sha256").update(workbook).digest("hex");
    const fileName = `ast-export-${exportId}.xlsx`;
    const commonBreakpoint = snapshots.find(item => item.metadata.breakpointSetId)?.metadata ?? snapshots[0].metadata;
    const metadata = { range: parsed.data, selection: "latest-created-plate-per-sample", sampleCount: snapshots.length,
      snapshots: snapshots.map(item => item.metadata.snapshot), includedSheets: ["Summary", "MICStatistics", "Method", "Wells"], includedSensitiveFields: ["syntheticSampleCode"],
      statisticsMethod: "nearest-rank interval bounds; grouped by organism/drug/unit; exclude unverified or duplicate measurements", noBreakpointPolicy: "AS_BLANK",
    };
    await prisma.$transaction(async tx => {
      await tx.exportRecord.create({ data: { id: exportId, plateId: snapshots[0].plate.id, organizationId: currentActor.organizationId, actorUserId: currentActor.userId,
        actorLabel: currentActor.userId, profile: "ANONYMIZED", fileName, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: workbook.length, checksumSha256,
        breakpointStandard: commonBreakpoint.breakpointStandard, breakpointVersion: commonBreakpoint.breakpointVersion,
        breakpointContentHash: commonBreakpoint.breakpointContentHash,
        metadataJson: metadata as unknown as Prisma.InputJsonValue, downloadedAt: generatedAt, expiresAt: new Date(generatedAt.getTime() + 15 * 60 * 1000),
      } });
      for (const action of ["EXPORT_SUCCEEDED", "EXPORT_DOWNLOADED"]) await tx.auditLog.create({ data: {
        actorId: currentActor.userId, actorLabel: currentActor.userId, action, entityType: "ExportRecord", entityId: exportId,
        afterJson: { ...metadata, organizationId: currentActor.organizationId, exportId, checksumSha256, timestamp: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
      } });
    });
    return new Response(new Uint8Array(workbook), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store, max-age=0", "x-export-id": exportId, "x-checksum-sha256": checksumSha256,
    } });
  } catch (error) {
    const code = error instanceof AuthError || error instanceof BatchExportError || error instanceof BreakpointLifecycleError ? error.code : "INTERNAL_ERROR";
    await audit(code === "FORBIDDEN" || code === "NOT_FOUND" ? "EXPORT_ACCESS_DENIED" : code === "BREAKPOINT_HASH_MISMATCH" ? "BREAKPOINT_HASH_MISMATCH" : "EXPORT_FAILED", { errorCode: code }).catch(() => undefined);
    const auth = authErrorResponse(error);
    if (auth) return auth;
    if (error instanceof BatchExportError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof BreakpointLifecycleError) return NextResponse.json({ error: { code: error.code, message: "Breakpointの整合性確認に失敗しました。管理者へお問い合わせください。" } }, { status: 409 });
    console.error({ event: "BATCH_EXPORT_FAILED", exportId });
    return NextResponse.json({ error: { code, message: "範囲出力に失敗しました。時間をおいて再試行してください。" } }, { status: 500 });
  }
}
