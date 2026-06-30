-- PostgreSQL production hardening companion for migration 0007.
-- Apply after the Prisma schema migration has created the lifecycle columns.
CREATE OR REPLACE FUNCTION prevent_immutable_breakpoint_set_change()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'RETIRED') THEN
    IF ROW(
      NEW."standard", NEW."version", NEW."organism", NEW."unit", NEW."method",
      NEW."effectiveFrom", NEW."effectiveTo", NEW."contentHash",
      NEW."approvedAt", NEW."approvedByUserId"
    ) IS DISTINCT FROM ROW(
      OLD."standard", OLD."version", OLD."organism", OLD."unit", OLD."method",
      OLD."effectiveFrom", OLD."effectiveTo", OLD."contentHash",
      OLD."approvedAt", OLD."approvedByUserId"
    ) THEN
      RAISE EXCEPTION 'immutable breakpoint set % cannot be changed', OLD."id";
    END IF;
    IF OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED' THEN
      RAISE EXCEPTION 'retired breakpoint set % cannot transition', OLD."id";
    END IF;
    IF OLD."status" = 'RETIRED' AND ROW(
      NEW."retiredAt", NEW."retiredByUserId", NEW."retireReason"
    ) IS DISTINCT FROM ROW(
      OLD."retiredAt", OLD."retiredByUserId", OLD."retireReason"
    ) THEN
      RAISE EXCEPTION 'retirement metadata for breakpoint set % is immutable', OLD."id";
    END IF;
    IF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'RETIRED') THEN
      RAISE EXCEPTION 'approved breakpoint set % cannot return to draft', OLD."id";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_immutable_breakpoint_rule_change()
RETURNS trigger AS $$
DECLARE parent_status text;
BEGIN
  SELECT "status" INTO parent_status
  FROM "BreakpointSet"
  WHERE "id" = COALESCE(NEW."breakpointSetId", OLD."breakpointSetId")
  FOR UPDATE;
  IF parent_status IN ('APPROVED', 'RETIRED') THEN
    RAISE EXCEPTION 'rules of immutable breakpoint set cannot be changed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_immutable_breakpoint_set_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'RETIRED') THEN
    RAISE EXCEPTION 'immutable breakpoint set % cannot be deleted', OLD."id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE UNIQUE INDEX IF NOT EXISTS "BreakpointSet_formal_org_standard_version_key"
ON "BreakpointSet" ("organizationId", "standard", "version")
WHERE "status" IN ('APPROVED', 'RETIRED');

DROP TRIGGER IF EXISTS breakpoint_set_immutable ON "BreakpointSet";
CREATE TRIGGER breakpoint_set_immutable
BEFORE UPDATE ON "BreakpointSet"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_breakpoint_set_change();

DROP TRIGGER IF EXISTS breakpoint_set_immutable_delete ON "BreakpointSet";
CREATE TRIGGER breakpoint_set_immutable_delete
BEFORE DELETE ON "BreakpointSet"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_breakpoint_set_delete();

DROP TRIGGER IF EXISTS breakpoint_rule_immutable ON "BreakpointRule";
CREATE TRIGGER breakpoint_rule_immutable
BEFORE INSERT OR UPDATE OR DELETE ON "BreakpointRule"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_breakpoint_rule_change();
