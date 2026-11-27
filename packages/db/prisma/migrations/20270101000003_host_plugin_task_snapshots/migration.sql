CREATE TABLE "host_plugin_task_snapshots" (
  "id" TEXT PRIMARY KEY,
  "pluginId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "botId" TEXT NOT NULL REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "bindingKey" TEXT NOT NULL,
  "cards" JSONB NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "host_plugin_task_snapshots_pluginId_spaceId_userId_botId_key"
  ON "host_plugin_task_snapshots" ("pluginId", "spaceId", "userId", "botId");
CREATE INDEX "host_plugin_task_snapshots_pluginId_checkedAt_idx"
  ON "host_plugin_task_snapshots" ("pluginId", "checkedAt");
CREATE INDEX "host_plugin_task_snapshots_spaceId_idx" ON "host_plugin_task_snapshots" ("spaceId");
CREATE INDEX "host_plugin_task_snapshots_userId_idx" ON "host_plugin_task_snapshots" ("userId");
CREATE INDEX "host_plugin_task_snapshots_botId_idx" ON "host_plugin_task_snapshots" ("botId");

ALTER TABLE "host_plugin_task_snapshots" ENABLE ROW LEVEL SECURITY;
CREATE POLICY host_plugin_task_snapshots_tenant ON "host_plugin_task_snapshots"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), '')
    AND "userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY host_plugin_task_snapshots_system ON "host_plugin_task_snapshots"
  USING ((SELECT app_rls_bypass()));
