-- Indexes for the API's default list orders and substring search, and one redundant index removed.
--
-- * statements: the default list order is `company_id = $1 ORDER BY uploaded_at, id`. No index had
--   uploaded_at, so every page read and sorted all of a company's statements.
-- * monitoring_events: the default list order is identified_on, and the dueDate sort orders every
--   event (NULLS LAST, no `due_date is not null` predicate), so the old partial due_date index served
--   no query. Both orders now have a (company_id, x) index; the id tiebreaker is an incremental sort.
-- * audit_logs.summary, communications.body and communications.counterparty_number are searched with
--   `ILIKE '%term%'` (searchFilter in backend/src/common/http/pagination.ts). A leading wildcard
--   cannot use a B-tree; trigram GIN keeps the substring semantics. Both communications columns need
--   their own index, because PostgREST ORs them and a BitmapOr needs an index on every arm.
-- * leases_property_idx (company_id, property_id) is the leading prefix of leases_unit_idx
--   (company_id, property_id, unit_id), which already serves property lookups and the
--   leases_property_fk check.
--
-- Plain CREATE INDEX (no CONCURRENTLY): migrations run in a transaction and the tables are small.

create index statements_company_uploaded_idx on public.statements (company_id, uploaded_at);

create index monitoring_events_company_identified_idx on public.monitoring_events (company_id, identified_on);
drop index public.monitoring_events_company_due_idx;
create index monitoring_events_company_due_idx on public.monitoring_events (company_id, due_date);

create extension if not exists pg_trgm with schema extensions;

create index audit_logs_summary_trgm_idx on public.audit_logs using gin (summary extensions.gin_trgm_ops);
create index communications_body_trgm_idx on public.communications using gin (body extensions.gin_trgm_ops);
create index communications_counterparty_number_trgm_idx
  on public.communications using gin (counterparty_number extensions.gin_trgm_ops);

drop index public.leases_property_idx;

-- Kept on purpose (it looks like a duplicate of the partial unique index, but is not one).
comment on index public.statements_company_sha256_idx is
  'Non-partial companion to statements_company_sha256_live_idx: generic (parameterised) PostgREST plans cannot prove the partial predicate, so they need this index.';
