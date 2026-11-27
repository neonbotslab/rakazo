CREATE TABLE "user_host_plugins" (
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "pluginId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  PRIMARY KEY ("userId", "pluginId")
);

ALTER TABLE "user_host_plugins" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_host_plugins_tenant ON "user_host_plugins"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY user_host_plugins_system ON "user_host_plugins" USING ((SELECT app_rls_bypass()));
