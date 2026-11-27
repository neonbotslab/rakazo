ALTER TABLE "external_effects"
  ADD COLUMN "pluginInvocationId" TEXT,
  ADD COLUMN "pluginResult" JSONB;

CREATE UNIQUE INDEX "external_effects_runId_pluginInvocationId_key"
  ON "external_effects" ("runId", "pluginInvocationId");
