-- PlateDrug.rowIndex is a drug assignment slot for flexible layouts, not a well row.
-- Physical well coordinates remain constrained by PlateWell's 8 x 12 checks.
-- A single statement keeps both DDL operations atomic without leaving Prisma's
-- connection in an aborted explicit transaction when a DDL operation fails.
DO $migration$
BEGIN
  ALTER TABLE public."PlateDrug" DROP CONSTRAINT "PlateDrug_row_range_check";
  ALTER TABLE public."PlateDrug"
    ADD CONSTRAINT "PlateDrug_row_range_check" CHECK ("rowIndex" BETWEEN 0 AND 95);
END
$migration$;
