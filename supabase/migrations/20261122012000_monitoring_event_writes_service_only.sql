-- Monitoring events are raised and removed by background jobs only (module 7 acceptance, follow-up to
-- 20261122010000_monitoring_event_status_workflow.sql).
--
-- That migration withdrew UPDATE from signed-in callers, but they kept INSERT and DELETE on `monitoring_events`
-- (writers_insert / writers_delete). Through the Data API a property manager could therefore still step around the
-- workflow: delete a resolved or dismissed event (no audit row; the history triggers fire on UPDATE only) and insert it
-- again as `new` with a rewritten title, description or calculation, or insert an event already `resolved` or
-- `dismissed` credited to another member at a back-dated time (the stamp trigger runs on UPDATE only).
--
-- The app never needed either privilege: events are raised by the monitoring and statement jobs with the service role
-- (`backend/src/workers/shared/monitoring-outputs.ts`), status changes go through `public.update_monitoring_event_status`,
-- and no API or database path removes an event for a signed-in caller (the foreign keys to the event's property, unit,
-- tenant, lease and statement are NO ACTION, unchanged here). Members keep SELECT (members_read).

drop policy writers_insert on public.monitoring_events;
drop policy writers_delete on public.monitoring_events;
revoke insert, delete on public.monitoring_events from authenticated;
