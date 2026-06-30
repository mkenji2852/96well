CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "plateId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "responseJson" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_organizationId_actorUserId_key_key"
  ON "IdempotencyRecord"("organizationId", "actorUserId", "key");

CREATE INDEX IF NOT EXISTS "IdempotencyRecord_plateId_createdAt_idx"
  ON "IdempotencyRecord"("plateId", "createdAt");
