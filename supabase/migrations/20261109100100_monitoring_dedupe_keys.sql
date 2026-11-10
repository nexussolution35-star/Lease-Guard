-- Database-level idempotency for monitoring outputs written by background jobs.
--
-- The daily monitoring jobs re-scan every company. Each event or notification they raise carries a
-- deterministic dedupe key (e.g. `lease_expiry:<lease id>:<expiry date>:<threshold>`), and the worker
-- inserts with ON CONFLICT (company_id, dedupe_key) DO NOTHING, so a re-scan, a retried job or two
-- workers racing never create a second row for the same finding. Rows created by people (and the demo
-- seed) leave the key NULL and are unaffected.
--
-- Uniqueness is a UNIQUE constraint rather than a partial unique index: NULL keys never conflict
-- (NULLS DISTINCT, the Postgres default), which gives the same semantics as
-- `unique (company_id, dedupe_key) where dedupe_key is not null`, but PostgREST's `on_conflict` (used
-- by supabase-js `upsert`) can only target a constraint or a non-partial unique index.
--
-- A dismissed or resolved event keeps its key, so the same finding is not raised again after a
-- property manager has dealt with it; a materially different finding (a later notice threshold, a
-- new statement, a changed shortfall) has a different key.

alter table public.monitoring_events
  add column dedupe_key text,
  add constraint monitoring_events_dedupe_key_check
    check (dedupe_key is null or (length(dedupe_key) between 1 and 300 and dedupe_key !~ '\s')),
  add constraint monitoring_events_company_dedupe_key unique (company_id, dedupe_key);

alter table public.notifications
  add column dedupe_key text,
  add constraint notifications_dedupe_key_check
    check (dedupe_key is null or (length(dedupe_key) between 1 and 300 and dedupe_key !~ '\s')),
  add constraint notifications_company_dedupe_key unique (company_id, dedupe_key);

comment on column public.monitoring_events.dedupe_key is
  'Deterministic key of the finding that raised this event (background jobs only); unique per company.';
comment on column public.notifications.dedupe_key is
  'Deterministic key of the notification (background jobs only, includes the recipient); unique per company.';
