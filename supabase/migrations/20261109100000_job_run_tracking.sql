-- Aligns job_runs with the worker's job-run events (backend/src/workers/jobs/idempotent-worker.ts).
--
-- The worker writes one row per finished attempt through the service role:
--   completed attempt          -> status 'succeeded'
--   re-delivered completed id  -> status 'skipped' (idempotency marker hit; nothing was processed)
--   failed attempt             -> status 'failed', will_retry tells whether BullMQ retries it
-- A failed row with will_retry = false is a failed job (dead letter) that needs attention.
--
-- Additive and safe for existing rows: new columns are nullable or defaulted, the status check is
-- widened, and company_id becomes nullable for system-level jobs that span companies (the daily
-- monitoring dispatch lists the active companies and enqueues one job per company). Every
-- company-scoped job still records its company.

alter table public.job_runs alter column company_id drop not null;

alter table public.job_runs drop constraint job_runs_status_check;
alter table public.job_runs add constraint job_runs_status_check
  check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'));

alter table public.job_runs
  add column max_attempts integer,
  add column will_retry boolean not null default false,
  add column duration_ms integer;

alter table public.job_runs
  add constraint job_runs_max_attempts_check check (max_attempts is null or max_attempts >= 1),
  add constraint job_runs_duration_check check (duration_ms is null or duration_ms >= 0),
  -- Only a failed attempt can be retried.
  add constraint job_runs_will_retry_check check (not will_retry or status = 'failed');

comment on column public.job_runs.attempts is '1-based attempt number this row records (0 while queued).';
comment on column public.job_runs.max_attempts is 'Attempts BullMQ allows for the job.';
comment on column public.job_runs.will_retry is 'True when this failed attempt will be retried with backoff.';
comment on column public.job_runs.duration_ms is 'Processing time of the attempt in milliseconds.';

-- Failed jobs that will not be retried, newest first: the operational failed-job list.
create index job_runs_dead_letter_idx on public.job_runs (queue, created_at desc)
  where status = 'failed' and not will_retry;
-- System-level runs (no company), e.g. the daily monitoring dispatch.
create index job_runs_system_idx on public.job_runs (queue, created_at desc) where company_id is null;
