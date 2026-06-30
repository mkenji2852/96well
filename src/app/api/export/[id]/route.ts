import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { AuthError, authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser, type AuthenticatedActor } from "@/lib/auth";
import { assertBreakpointContentHash, BreakpointLifecycleError } from "@/lib/breakpoint-lifecycle";
import { buildPlateWorkbook, parseExportProfile, type ExportMetadata } from "@/lib/excel";
import { prisma } from "@/lib/prisma";
import { requirePermission, requirePlateAccess, type Permission } from "@/lib/rbac";
import type { ExportProfile, NoBreakpointOutputPolicy } from "@/types/domain";

type RouteContext = { params: Promise<{ id: string }> };

class ExportRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExportRequestError";
  }
}

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function policy(value: string | null): NoBreakpointOutputPolicy {
  return value === "AS_NA" || value === "AS_BLANK" ? value : "AS_NO_BREAKPOINT";
}

function permissionForProfile(profile: ExportProfile): Permission {
  if (profile === "CLINICAL_INTERNAL") return "export:clinical";
  if (profile === "AUDIT_FULL") return "export:audit";
  return "export:anonymized";
}

function includedSheets(profile: ExportProfile): string[] {
  if (profile === "AUDIT_FULL") return ["Summary", "Wells", "Method", "ReviewHistory", "InterpretationHistory", "Audit", "ExportMetadata"];
  if (profile === "CLINICAL_INTERNAL") return ["Summary", "Wells", "Method", "ReviewSummary"];
  return ["Summary", "Wells", "Method"];
}

function includedSensitiveFields(profile: ExportProfile, includeNotes: boolean): string[] {
  const fields: string[] = [];
  if (profile !== "ANONYMIZED") fields.push("sampleCode");
  if (includeNotes) fields.push("notes");
  if (profile === "AUDIT_FULL") fields.push("actorUserId", "auditAllowedFields", "internalResultIds", "reviewerUserId", "overrideReason");
  if (profile === "CLINICAL_INTERNAL") fields.push("technicalResultIds", "reviewSummary");
  return fields;
}

async function auditExport(
  action: string,
  actor: AuthenticatedActor,
  plateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: actor.userId,
      actorLabel: actor.userId,
      action,
      entityType: "Plate",
      entityId: plateId,
      afterJson: inputJson({
        actorUserId: actor.userId,
        organizationId: actor.organizationId,
        plateId,
        timestamp: new Date().toISOString(),
        sessionId: actor.sessionId,
        ...payload,
      }),
    },
  }).catch(() => undefined);
}

function assertProfileOptions({
  actor,
  profile,
  includeNotes,
  acknowledgedSensitive,
  reason,
  allowMixedBreakpointSets,
}: {
  actor: AuthenticatedActor;
  profile: ExportProfile;
  includeNotes: boolean;
  acknowledgedSensitive: boolean;
  reason: string | null;
  allowMixedBreakpointSets: boolean;
}) {
  requirePermission(actor, permissionForProfile(profile));
  if (profile === "AUDIT_FULL" && !reason?.trim()) {
    throw new ExportRequestError("EXPORT_REASON_REQUIRED", "監査出力には出力理由が必要です。", 400);
  }
  if (profile !== "AUDIT_FULL" && allowMixedBreakpointSets) {
    throw new ExportRequestError("MIXED_BREAKPOINTS_AUDIT_ONLY", "breakpoint混在許可は監査出力でのみ利用できます。", 403);
  }
  if (includeNotes) {
    requirePermission(actor, "export:notes");
    if (profile === "ANONYMIZED") {
      throw new ExportRequestError("NOTES_NOT_ALLOWED_FOR_ANONYMIZED", "匿名化出力にnotesは含められません。", 400);
    }
    if (!acknowledgedSensitive) {
      throw new ExportRequestError("SENSITIVE_FIELD_ACK_REQUIRED", "notesを含めるには明示的な確認が必要です。", 400);
    }
  }
}

function safeReason(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 1000) : null;
}

function responseFileName(exportId: string): string {
  return `ast-export-${exportId.replace(/[^a-zA-Z0-9_-]/g, "")}.xlsx`;
}

export async function GET(request: Request, { params }: RouteContext) {
  const exportId = randomUUID();
  let actor: AuthenticatedActor | null = null;
  let plateId = "";
  let profile: ExportProfile = "ANONYMIZED";
  let reason: string | null = null;

  try {
    actor = await requireAuthenticatedUser(request);
    const currentActor = actor;
    const { id } = await params;
    plateId = id;
    const url = new URL(request.url);
    profile = parseExportProfile(url.searchParams.get("profile"));
    reason = safeReason(url.searchParams.get("reason"));
    const includeNotes = url.searchParams.get("includeNotes") === "true";
    const acknowledgedSensitive = url.searchParams.get("acknowledgeSensitive") === "true";
    const allowMixedBreakpointSets = url.searchParams.get("allowMixedBreakpointSets") === "true";
    const requestedStandard = url.searchParams.get("standard");
    const requestedVersion = url.searchParams.get("version");
    const requestedBreakpointSetId = url.searchParams.get("breakpointSetId");
    const noBreakpointPolicy = policy(url.searchParams.get("noBreakpointPolicy"));

    await auditExport(profile === "AUDIT_FULL" ? "AUDIT_EXPORT_REQUESTED" : "EXPORT_REQUESTED", currentActor, id, {
      exportId,
      profile,
      reason,
      includeNotes,
      allowMixedBreakpointSets,
    });

    try {
      assertProfileOptions({ actor: currentActor, profile, includeNotes, acknowledgedSensitive, reason, allowMixedBreakpointSets });
    } catch (error) {
      await auditExport("EXPORT_ACCESS_DENIED", currentActor, id, {
        exportId,
        profile,
        reason,
        errorCode: error instanceof AuthError ? error.code : error instanceof ExportRequestError ? error.code : "FORBIDDEN",
      });
      throw error;
    }

    await requirePlateAccess(currentActor, id);
    if (Boolean(requestedStandard) !== Boolean(requestedVersion)) {
      throw new ExportRequestError("STANDARD_AND_VERSION_REQUIRED_TOGETHER", "standardとversionは同時に指定してください。", 400);
    }

    const generatedAt = new Date();
    const expiresAt = new Date(generatedAt.getTime() + 15 * 60 * 1000);
    const snapshot = await prisma.$transaction(async (tx) => {
      const plate = await tx.plate.findFirst({
        where: { id, organizationId: currentActor.organizationId },
        include: {
          sample: true,
          drugs: { orderBy: { rowIndex: "asc" } },
          wells: { orderBy: [{ rowIndex: "asc" }, { columnIndex: "asc" }] },
          rawMics: {
            where: profile === "AUDIT_FULL" ? {} : { status: "CURRENT" },
            orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
            include: {
              plateDrug: true,
              interpretations: {
                where: profile === "AUDIT_FULL" ? {} : { status: "CURRENT" },
                orderBy: [{ calculatedAt: "desc" }, { id: "desc" }],
              },
            },
          },
          imageAssessments: {
            include: {
              reviews: { orderBy: { reviewedAt: "desc" } },
              overrides: { orderBy: { createdAt: "asc" } },
            },
          },
        },
      });
      if (!plate) throw new AuthError("NOT_FOUND", "対象のプレートが見つかりません。");

      const currentRawMics = plate.rawMics.filter((mic) => mic.status === "CURRENT");
      const currentInterpretations = currentRawMics.flatMap((mic) => mic.interpretations.filter((item) => item.status === "CURRENT"));
      const currentBreakpointSetIds = new Set(currentRawMics.map((mic) => mic.breakpointSetId).filter(Boolean));
      const currentStandardVersions = new Set(currentInterpretations.map((item) => `${item.standard ?? ""}:${item.ruleVersion ?? ""}`));
      if (requestedBreakpointSetId && [...currentBreakpointSetIds].some((value) => value !== requestedBreakpointSetId)) {
        throw new ExportRequestError("BREAKPOINT_SET_NOT_SAVED_AS_CURRENT", "指定されたbreakpointSetは現在結果として保存されていません。", 409);
      }
      if (currentBreakpointSetIds.size > 1 && !(profile === "AUDIT_FULL" && allowMixedBreakpointSets)) {
        throw new ExportRequestError("MIXED_BREAKPOINT_SETS_REQUIRE_AUDIT", "1ファイル内でbreakpointSetが混在するため通常出力を拒否しました。", 409);
      }
      if (currentStandardVersions.size > 1 && !(profile === "AUDIT_FULL" && allowMixedBreakpointSets)) {
        throw new ExportRequestError("MIXED_BREAKPOINT_VERSIONS_REQUIRE_AUDIT", "1ファイル内でbreakpoint標準/版が混在するため通常出力を拒否しました。", 409);
      }
      if (requestedStandard && currentInterpretations.some((item) => item.standard !== requestedStandard || item.ruleVersion !== requestedVersion)) {
        throw new ExportRequestError("INTERPRETATION_VERSION_NOT_SAVED", "指定されたbreakpoint標準/版は現在結果と一致しません。", 409);
      }

      const breakpointSetIds = [...currentBreakpointSetIds];
      if (breakpointSetIds.length > 0) {
        const approvedSets = await tx.breakpointSet.findMany({
          where: { id: { in: breakpointSetIds }, organizationId: currentActor.organizationId },
          include: { rules: true },
        });
        if (
          approvedSets.length !== breakpointSetIds.length ||
          approvedSets.some((set) => set.status !== "APPROVED" && set.status !== "RETIRED")
        ) {
          throw new ExportRequestError("BREAKPOINT_SET_NOT_APPROVED", "承認済みかつ有効なbreakpointSetだけを正式出力できます。", 409);
        }
        for (const set of approvedSets) {
          try {
            assertBreakpointContentHash(set);
          } catch (error) {
            if (error instanceof BreakpointLifecycleError && error.code === "BREAKPOINT_HASH_MISMATCH") {
              throw new ExportRequestError("BREAKPOINT_HASH_MISMATCH", error.message, 409);
            }
            throw error;
          }
        }
      }

      const auditLogs = profile === "AUDIT_FULL"
        ? await tx.auditLog.findMany({
          where: { OR: [{ entityType: "Plate", entityId: id }, { entityType: "Sample", entityId: plate.sampleId }] },
          orderBy: { createdAt: "asc" },
        })
        : [];

      const exportedRawMics = profile === "AUDIT_FULL"
        ? plate.rawMics
        : currentRawMics.map((mic) => ({
          ...mic,
          interpretations: mic.interpretations.filter((item) => item.status === "CURRENT").slice(0, 1),
        }));
      const exportedSirIds = exportedRawMics.flatMap((mic) => mic.interpretations.map((item) => item.id));
      const exportedImageReviewIds = profile === "ANONYMIZED"
        ? []
        : plate.imageAssessments.flatMap((assessment) => assessment.reviews.map((review) => review.id));
      const selectedInterpretation = currentInterpretations[0] ?? null;
      const selectedBreakpointSetId = currentBreakpointSetIds.size === 1 ? breakpointSetIds[0] : null;
      const selectedBreakpointSet = selectedBreakpointSetId
        ? await tx.breakpointSet.findFirst({
          where: { id: selectedBreakpointSetId, organizationId: currentActor.organizationId },
          select: { contentHash: true, status: true, approvedByUserId: true, approvedAt: true },
        })
        : null;
      const metadata: ExportMetadata = {
        exportId,
        profile,
        generatedAt,
        pseudonymousSampleId: `AST-${exportId.slice(0, 12)}`,
        breakpointSetId: selectedBreakpointSetId,
        breakpointStandard: selectedInterpretation?.standard ?? null,
        breakpointVersion: selectedInterpretation?.ruleVersion ?? null,
        breakpointContentHash: selectedBreakpointSet?.contentHash ?? null,
        breakpointStatus: selectedBreakpointSet?.status ?? null,
        breakpointApprovedByUserId: selectedBreakpointSet?.approvedByUserId ?? null,
        breakpointApprovedAt: selectedBreakpointSet?.approvedAt ?? null,
        noBreakpointPolicy,
        includeNotes,
        reason,
        snapshot: {
          plateId: id,
          plateRevision: plate.updatedAt.toISOString(),
          wellRevision: plate.wellRevision,
          resultRevision: plate.resultRevision,
          breakpointSetId: selectedBreakpointSetId,
          rawMicIds: exportedRawMics.map((mic) => mic.id),
          sirInterpretationIds: exportedSirIds,
          imageReviewIds: exportedImageReviewIds,
        },
      };

      return {
        plate: { ...plate, rawMics: exportedRawMics },
        auditLogs,
        metadata,
      };
    });

    const workbook = await buildPlateWorkbook(snapshot);
    const fileName = responseFileName(exportId);
    const checksumSha256 = createHash("sha256").update(workbook).digest("hex");
    const metadataJson = {
      ...snapshot.metadata,
      generatedAt: snapshot.metadata.generatedAt.toISOString(),
      breakpointApprovedAt: snapshot.metadata.breakpointApprovedAt?.toISOString() ?? null,
      snapshot: snapshot.metadata.snapshot,
      includedSheets: includedSheets(profile),
      includedSensitiveFields: includedSensitiveFields(profile, includeNotes),
      checksumSha256,
      expiresAt: expiresAt.toISOString(),
    };

    await prisma.$transaction([
      prisma.exportRecord.create({
        data: {
          id: exportId,
          plateId: id,
          organizationId: currentActor.organizationId,
          actorUserId: currentActor.userId,
          profile,
          reason,
          fileName,
          mimeType: MIME_XLSX,
          sizeBytes: workbook.byteLength,
          checksumSha256,
          breakpointStandard: snapshot.metadata.breakpointStandard,
          breakpointVersion: snapshot.metadata.breakpointVersion,
          breakpointContentHash: snapshot.metadata.breakpointContentHash,
          metadataJson: inputJson(metadataJson),
          actorLabel: currentActor.userId,
          expiresAt,
          downloadedAt: generatedAt,
        },
      }),
      prisma.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: profile === "AUDIT_FULL" ? "AUDIT_EXPORT_SUCCEEDED" : "EXPORT_SUCCEEDED",
          entityType: "Plate",
          entityId: id,
          afterJson: inputJson({
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            exportId,
            profile,
            reason,
            plateId: id,
            plateRevision: snapshot.metadata.snapshot.plateRevision,
            wellRevision: snapshot.metadata.snapshot.wellRevision,
            resultRevision: snapshot.metadata.snapshot.resultRevision,
            breakpointSetId: snapshot.metadata.snapshot.breakpointSetId,
            rawMicIds: snapshot.metadata.snapshot.rawMicIds,
            sirInterpretationIds: snapshot.metadata.snapshot.sirInterpretationIds,
            includedSheets: includedSheets(profile),
            includedSensitiveFields: includedSensitiveFields(profile, includeNotes),
            checksumSha256,
            timestamp: new Date().toISOString(),
            success: true,
            sessionId: currentActor.sessionId,
          }),
        },
      }),
      prisma.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "EXPORT_DOWNLOADED",
          entityType: "Plate",
          entityId: id,
          afterJson: inputJson({
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            exportId,
            profile,
            plateId: id,
            timestamp: new Date().toISOString(),
            sessionId: currentActor.sessionId,
          }),
        },
      }),
    ]);

    return new Response(new Uint8Array(workbook), {
      headers: {
        "content-type": MIME_XLSX,
        "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
        "cache-control": "private, no-store, max-age=0",
        pragma: "no-cache",
        expires: "0",
        "x-export-id": exportId,
        "x-checksum-sha256": checksumSha256,
      },
    });
  } catch (error) {
    if (actor && plateId) {
      const auth = error instanceof AuthError ? error : null;
      const request = error instanceof ExportRequestError ? error : null;
      const code = request?.code ?? auth?.code ?? "INTERNAL_ERROR";
      await auditExport(
        code === "FORBIDDEN" || code === "NOT_FOUND"
          ? "EXPORT_ACCESS_DENIED"
          : code === "BREAKPOINT_HASH_MISMATCH" ? "BREAKPOINT_HASH_MISMATCH" : "EXPORT_FAILED",
        actor,
        plateId,
        {
        exportId,
        profile,
        reason,
        success: false,
        errorCode: code,
        },
      );
    }
    if (error instanceof ExportRequestError) return jsonError(error.code, error.message, error.status);
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return jsonError("INTERNAL_ERROR", "処理に失敗しました。", 500);
  }
}
