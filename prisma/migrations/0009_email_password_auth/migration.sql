CREATE TABLE IF NOT EXISTS "UserInvite" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "inviteTokenHash" TEXT,
  "inviteCreatedAt" DATETIME,
  "expiresAt" DATETIME,
  "redeemedAt" DATETIME,
  "redeemedByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "createdByUserId" TEXT,
  CONSTRAINT "UserInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "UserInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UserInvite_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserInvite_organizationId_email_key" ON "UserInvite"("organizationId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "UserInvite_inviteTokenHash_key" ON "UserInvite"("inviteTokenHash");
CREATE INDEX IF NOT EXISTS "UserInvite_email_idx" ON "UserInvite"("email");
CREATE INDEX IF NOT EXISTS "UserInvite_organizationId_active_redeemedAt_idx" ON "UserInvite"("organizationId", "active", "redeemedAt");

CREATE TABLE "PasswordCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "passwordUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PasswordCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PasswordCredential_userId_key" ON "PasswordCredential"("userId");

CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME,
  CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");
