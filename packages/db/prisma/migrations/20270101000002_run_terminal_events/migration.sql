CREATE TABLE "run_terminal_events" (
  "runId" TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('completed', 'failed', 'cancelled')),
  "finishedAt" TIMESTAMP(3) NOT NULL,
  "deliveredPluginIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dispatchedAt" TIMESTAMP(3)
);

CREATE INDEX "run_terminal_events_spaceId_idx" ON "run_terminal_events" ("spaceId");
CREATE INDEX run_terminal_events_pending_idx ON "run_terminal_events" ("runId")
  WHERE "dispatchedAt" IS NULL;
ALTER TABLE "run_terminal_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY run_terminal_events_system ON "run_terminal_events" USING ((SELECT app_rls_bypass()));

-- Old writers can still finalize runs while the new worker is starting. Keep capture and the
-- backup in their transaction, and wake the live server only after commit through NOTIFY.
CREATE FUNCTION public.record_run_terminal_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $terminal$
DECLARE
  finished_at TIMESTAMP(3);
  has_enabled_plugin BOOLEAN;
BEGIN
  IF NEW.status NOT IN ('completed', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('completed', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  finished_at := COALESCE(NEW."completedAt", clock_timestamp() AT TIME ZONE 'UTC');
  SELECT EXISTS (
    SELECT 1 FROM public.user_host_plugins WHERE "userId" = NEW."userId" AND enabled
  ) INTO has_enabled_plugin;
  INSERT INTO public.run_terminal_events (
    "runId", "spaceId", "userId", "threadId", "botId", status, "finishedAt", "dispatchedAt"
  ) VALUES (
    NEW.id, NEW."spaceId", NEW."userId", NEW."threadId", NEW."botId", NEW.status, finished_at,
    CASE WHEN NOT has_enabled_plugin THEN finished_at END
  ) ON CONFLICT ("runId") DO NOTHING;

  IF FOUND AND has_enabled_plugin THEN
    -- The application schema can exist before the job queue is installed.
    IF to_regnamespace('graphile_worker') IS NOT NULL THEN
      PERFORM graphile_worker.add_job(
        'plugin.turn-finished', json_build_object('runId', NEW.id),
        run_at => now() + interval '90 seconds', job_key => 'plugin.turn-finished:' || NEW.id
      );
    END IF;
    PERFORM pg_notify('rakazo_events', json_build_object(
      'topic', 'plugin.turn-finished', 'payload', NEW.id
    )::TEXT);
  END IF;
  RETURN NEW;
END;
$terminal$;

REVOKE ALL ON FUNCTION public.record_run_terminal_event() FROM PUBLIC;

CREATE TRIGGER runs_record_terminal_event AFTER INSERT OR UPDATE OF status ON "runs"
FOR EACH ROW EXECUTE FUNCTION public.record_run_terminal_event();
