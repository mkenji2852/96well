-- Research-public invite based auto-provisioning.
-- Only invited email addresses can redeem access after Cloudflare Access JWT verification.

CREATE TABLE "UserInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,

    CONSTRAINT "UserInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserInvite_organizationId_email_key" ON "UserInvite"("organizationId", "email");
CREATE INDEX "UserInvite_email_idx" ON "UserInvite"("email");
CREATE INDEX "UserInvite_organizationId_active_redeemedAt_idx" ON "UserInvite"("organizationId", "active", "redeemedAt");

ALTER TABLE "UserInvite"
  ADD CONSTRAINT "UserInvite_email_lowercase_check" CHECK ("email" = lower("email"));

ALTER TABLE "UserInvite"
  ADD CONSTRAINT "UserInvite_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserInvite"
  ADD CONSTRAINT "UserInvite_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserInvite"
  ADD CONSTRAINT "UserInvite_redeemedByUserId_fkey"
  FOREIGN KEY ("redeemedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
