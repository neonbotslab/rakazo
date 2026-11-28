CREATE TYPE "OwnerRulesVersionReason" AS ENUM ('saved', 'restored');

ALTER TABLE "owner_rules_versions"
  ADD COLUMN "sessionId" UUID,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "reason" "OwnerRulesVersionReason" NOT NULL DEFAULT 'saved';

CREATE UNIQUE INDEX "owner_rules_versions_userId_sessionId_key"
  ON "owner_rules_versions" ("userId", "sessionId");

CREATE POLICY owner_rules_versions_update ON "owner_rules_versions" FOR UPDATE
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK ("userId" = NULLIF(current_setting('app.user_id', true), ''));
