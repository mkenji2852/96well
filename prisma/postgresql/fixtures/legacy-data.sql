\set ON_ERROR_STOP on

INSERT INTO "Organization" ("id", "name") VALUES ('legacy-org', 'Legacy Org');
INSERT INTO "User" ("id", "organizationId", "name", "email", "role")
VALUES
  ('legacy-admin', 'legacy-org', 'Legacy Admin', 'legacy-admin@example.test', 'ADMIN'),
  ('legacy-reviewer', 'legacy-org', 'Legacy Reviewer', 'legacy-reviewer@example.test', 'REVIEWER');

INSERT INTO "Sample" ("id", "organizationId", "createdByUserId", "sampleCode", "organism", "notes", "updatedAt")
VALUES ('legacy-sample', 'legacy-org', NULL, 'LEGACY-SAMPLE-001', 'E. coli', repeat('非ASCII notes ', 100), now());

INSERT INTO "Plate" ("id", "sampleId", "organizationId", "name", "status", "wellRevision", "resultRevision", "updatedAt")
VALUES ('legacy-plate', 'legacy-sample', 'legacy-org', 'Legacy Plate', 'REVIEW_REQUIRED', 3, 2, now());

INSERT INTO "PlateDrug" ("id", "plateId", "rowIndex", "drugName", "unit", "concentrations")
VALUES ('legacy-drug', 'legacy-plate', 0, 'AMP', 'µg/mL', '[1,2,4,8]'::jsonb);

INSERT INTO "PlateWell" ("id", "plateId", "rowIndex", "columnIndex", "state", "source", "needsReview")
VALUES
  ('legacy-well-a1', 'legacy-plate', 0, 0, 'GROWTH', 'IMAGE_ASSISTED', true),
  ('legacy-well-a2', 'legacy-plate', 0, 1, 'INHIBITED', 'MANUAL', false);

INSERT INTO "BreakpointSet" (
  "id", "organizationId", "standard", "version", "organism", "status",
  "contentHashAlgorithm", "contentHashVersion", "createdByUserId", "updatedAt"
) VALUES (
  'legacy-bps-draft', 'legacy-org', 'CLSI', 'legacy-review-required', 'E. coli', 'DRAFT',
  'sha256', 1, 'legacy-admin', now()
);

INSERT INTO "BreakpointRule" (
  "id", "organizationId", "breakpointSetId", "drugName", "organism", "standard", "version",
  "susceptibleMax", "resistantMin", "unit", "method", "updatedAt"
) VALUES (
  'legacy-rule', 'legacy-org', 'legacy-bps-draft', 'AMP', 'E. coli', 'CLSI', 'legacy-review-required',
  1, 4, 'µg/mL', 'BROTH_MICRODILUTION', now()
);

INSERT INTO "RawMic" (
  "id", "plateId", "plateDrugId", "value", "modifier", "rawMicOperator",
  "breakpointSetId", "status", "sourceWellRevision", "createdByUserId"
) VALUES (
  'legacy-raw-current', 'legacy-plate', 'legacy-drug', 2, 'EQUAL', '=',
  'legacy-bps-draft', 'CURRENT', 3, NULL
);

INSERT INTO "SirInterpretation" (
  "id", "rawMicId", "plateId", "plateDrugId", "breakpointSetId", "breakpointRuleId",
  "category", "standard", "ruleVersion", "status", "calculatedByUserId"
) VALUES (
  'legacy-sir-current', 'legacy-raw-current', 'legacy-plate', 'legacy-drug', 'legacy-bps-draft', 'legacy-rule',
  'I', 'CLSI', 'legacy-review-required', 'CURRENT', NULL
);

INSERT INTO "AuditLog" ("id", "actorId", "actorLabel", "action", "entityType", "entityId", "afterJson")
VALUES ('legacy-audit-null-actor', NULL, 'legacy-import', 'LEGACY_IMPORTED', 'Plate', 'legacy-plate', '{"actorUserId": null}'::jsonb);

INSERT INTO "ExportRecord" (
  "id", "plateId", "organizationId", "actorUserId", "profile", "fileName", "mimeType",
  "sizeBytes", "checksumSha256", "metadataJson", "actorLabel"
) VALUES (
  'legacy-export', 'legacy-plate', 'legacy-org', NULL, 'ANONYMIZED', 'ast-export-legacy.xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  1, repeat('0', 64), '{"legacy": true}'::jsonb, 'legacy-import'
);
