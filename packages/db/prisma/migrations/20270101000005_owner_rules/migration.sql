CREATE TABLE "owner_rules_versions" (
  "id" SERIAL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "owner_rules_versions_userId_id_idx" ON "owner_rules_versions" ("userId", "id" DESC);

ALTER TABLE "owner_rules_versions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_rules_versions_read ON "owner_rules_versions" FOR SELECT
  USING ("userId" = NULLIF(current_setting('app.user_id', true), '') OR (SELECT app_rls_bypass()));
CREATE POLICY owner_rules_versions_write ON "owner_rules_versions" FOR INSERT
  WITH CHECK ("userId" = NULLIF(current_setting('app.user_id', true), ''));
