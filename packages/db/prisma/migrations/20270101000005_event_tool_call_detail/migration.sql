ALTER TABLE "events" ADD COLUMN "toolCallDetail" JSONB;

CREATE FUNCTION public.clear_ended_run_tool_call_detail() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $cleanup$
BEGIN
  UPDATE public.events SET "toolCallDetail" = NULL
    WHERE "runId" = NEW.id AND "spaceId" = NEW."spaceId" AND "threadId" = NEW."threadId"
      AND "toolCallDetail" IS NOT NULL;
  RETURN NEW;
END;
$cleanup$;

CREATE TRIGGER runs_clear_tool_call_detail AFTER UPDATE OF status ON "runs"
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('completed', 'failed', 'cancelled'))
EXECUTE FUNCTION public.clear_ended_run_tool_call_detail();
