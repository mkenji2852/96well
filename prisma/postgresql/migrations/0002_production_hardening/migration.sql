-- PostgreSQL production hardening for clinical data integrity.
-- Prisma cannot represent these partial indexes, check constraints, and immutability triggers.

-- CURRENT result uniqueness. These are the DB backstop for append-only result history.
CREATE UNIQUE INDEX "RawMic_current_plate_drug_key"
ON "RawMic" ("plateId", "plateDrugId")
WHERE "status" = 'CURRENT';

CREATE UNIQUE INDEX "SirInterpretation_current_plate_drug_key"
ON "SirInterpretation" ("plateId", "plateDrugId")
WHERE "status" = 'CURRENT';

-- Formal BreakpointSet versions cannot be duplicated once approved/retired.
CREATE UNIQUE INDEX "BreakpointSet_formal_org_standard_version_key"
ON "BreakpointSet" ("organizationId", "standard", "version")
WHERE "status" IN ('APPROVED', 'RETIRED');

-- Lightweight shape constraints. Business validation remains in application code.
ALTER TABLE "PlateWell"
  ADD CONSTRAINT "PlateWell_row_range_check" CHECK ("rowIndex" BETWEEN 0 AND 7),
  ADD CONSTRAINT "PlateWell_column_range_check" CHECK ("columnIndex" BETWEEN 0 AND 11);

ALTER TABLE "PlateDrug"
  ADD CONSTRAINT "PlateDrug_row_range_check" CHECK ("rowIndex" BETWEEN 0 AND 7);

ALTER TABLE "BreakpointRule"
  ADD CONSTRAINT "BreakpointRule_boundary_order_check" CHECK ("susceptibleMax" < "resistantMin"),
  ADD CONSTRAINT "BreakpointRule_intermediate_min_check" CHECK ("intermediateMin" IS NULL OR "intermediateMin" > "susceptibleMax"),
  ADD CONSTRAINT "BreakpointRule_intermediate_max_check" CHECK ("intermediateMax" IS NULL OR "intermediateMax" < "resistantMin"),
  ADD CONSTRAINT "BreakpointRule_intermediate_order_check" CHECK (
    "intermediateMin" IS NULL OR "intermediateMax" IS NULL OR "intermediateMin" <= "intermediateMax"
  );

ALTER TABLE "BreakpointSet"
  ADD CONSTRAINT "BreakpointSet_effective_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" > "effectiveFrom"),
  ADD CONSTRAINT "BreakpointSet_hash_metadata_check" CHECK (
    ("contentHash" IS NULL AND "status" = 'DRAFT')
    OR ("contentHash" IS NOT NULL AND "contentHashAlgorithm" = 'sha256' AND "contentHashVersion" = 1)
  ),
  ADD CONSTRAINT "BreakpointSet_approved_metadata_check" CHECK (
    "status" <> 'APPROVED'
    OR ("approvedAt" IS NOT NULL AND "approvedByUserId" IS NOT NULL AND "contentHash" IS NOT NULL)
  ),
  ADD CONSTRAINT "BreakpointSet_retired_metadata_check" CHECK (
    "status" <> 'RETIRED'
    OR ("retiredAt" IS NOT NULL AND "retiredByUserId" IS NOT NULL AND length(trim(coalesce("retireReason", ''))) > 0)
  );

CREATE OR REPLACE FUNCTION ast_prevent_immutable_breakpoint_set_update()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'RETIRED') THEN
    IF ROW(
      NEW."standard", NEW."version", NEW."organism", NEW."unit", NEW."method",
      NEW."effectiveFrom", NEW."effectiveTo", NEW."sourceDocumentReference",
      NEW."sourceDocumentChecksum", NEW."supersedesBreakpointSetId",
      NEW."contentHash", NEW."contentHashAlgorithm", NEW."contentHashVersion",
      NEW."approvedAt", NEW."approvedByUserId"
    ) IS DISTINCT FROM ROW(
      OLD."standard", OLD."version", OLD."organism", OLD."unit", OLD."method",
      OLD."effectiveFrom", OLD."effectiveTo", OLD."sourceDocumentReference",
      OLD."sourceDocumentChecksum", OLD."supersedesBreakpointSetId",
      OLD."contentHash", OLD."contentHashAlgorithm", OLD."contentHashVersion",
      OLD."approvedAt", OLD."approvedByUserId"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'AST_BREAKPOINT_IMMUTABLE_SET_CONTENT',
        DETAIL = OLD."id";
    END IF;

    IF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'RETIRED') THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'AST_BREAKPOINT_INVALID_TRANSITION',
        DETAIL = OLD."id";
    END IF;

    IF OLD."status" = 'RETIRED' THEN
      IF NEW."status" <> 'RETIRED' THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'AST_BREAKPOINT_RETIRED_FINAL',
          DETAIL = OLD."id";
      END IF;
      IF ROW(NEW."retiredAt", NEW."retiredByUserId", NEW."retireReason") IS DISTINCT FROM
         ROW(OLD."retiredAt", OLD."retiredByUserId", OLD."retireReason") THEN
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'AST_BREAKPOINT_RETIREMENT_METADATA_IMMUTABLE',
          DETAIL = OLD."id";
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ast_prevent_immutable_breakpoint_set_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'RETIRED') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'AST_BREAKPOINT_IMMUTABLE_SET_DELETE',
      DETAIL = OLD."id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ast_prevent_immutable_breakpoint_rule_change()
RETURNS trigger AS $$
DECLARE
  old_status "BreakpointSetStatus";
  new_status "BreakpointSetStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_status
    FROM "BreakpointSet"
    WHERE "id" = OLD."breakpointSetId"
    FOR UPDATE;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status" INTO new_status
    FROM "BreakpointSet"
    WHERE "id" = NEW."breakpointSetId"
    FOR UPDATE;
  END IF;

  IF old_status IN ('APPROVED', 'RETIRED') OR new_status IN ('APPROVED', 'RETIRED') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'AST_BREAKPOINT_IMMUTABLE_RULE',
      DETAIL = COALESCE(NEW."breakpointSetId", OLD."breakpointSetId");
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER breakpoint_set_immutable_update
BEFORE UPDATE ON "BreakpointSet"
FOR EACH ROW EXECUTE FUNCTION ast_prevent_immutable_breakpoint_set_update();

CREATE TRIGGER breakpoint_set_immutable_delete
BEFORE DELETE ON "BreakpointSet"
FOR EACH ROW EXECUTE FUNCTION ast_prevent_immutable_breakpoint_set_delete();

CREATE TRIGGER breakpoint_rule_immutable_change
BEFORE INSERT OR UPDATE OR DELETE ON "BreakpointRule"
FOR EACH ROW EXECUTE FUNCTION ast_prevent_immutable_breakpoint_rule_change();
