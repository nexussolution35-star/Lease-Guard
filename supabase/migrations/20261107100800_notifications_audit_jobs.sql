-- In-app notifications, the immutable audit log and background job runs.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null,
  type public.notification_type not null,
  severity public.notification_severity not null default 'info',
  title text not null,
  body text not null,
  read boolean not null default false,
  read_at timestamptz,
  link_entity_type public.entity_type,
  link_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_company_id_key unique (company_id, id),
  constraint notifications_link_check check ((link_entity_type is null) = (link_entity_id is null)),
  constraint notifications_read_check check (read or read_at is null),
  constraint notifications_user_fk foreign key (company_id, user_id)
    references public.company_users (company_id, user_id) on delete cascade
);
create index notifications_user_unread_idx on public.notifications (company_id, user_id, created_at desc) where not read;
create index notifications_user_idx on public.notifications (company_id, user_id, created_at desc);

-- Append-only. Rows are written by the audit triggers, the backend, or a member recording their
-- own action; nobody can change or remove them.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  -- NULL for actions taken by background jobs with no signed-in user.
  actor_user_id uuid references public.profiles (id),
  action public.audit_action not null,
  entity_type public.entity_type not null,
  entity_id uuid not null,
  summary text not null,
  -- FieldChange[]: [{ field, before, after }] with scalar before/after values.
  changes jsonb check (changes is null or jsonb_typeof(changes) = 'array'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index audit_logs_company_occurred_idx on public.audit_logs (company_id, occurred_at desc);
create index audit_logs_entity_idx on public.audit_logs (company_id, entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id) where actor_user_id is not null;

create function private.reject_audit_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = 'insufficient_privilege';
end;
$$;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.reject_audit_log_change();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.reject_audit_log_change();

-- One row per background job execution (BullMQ). Backend-only: no end-user access.
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  queue text not null,
  job_name text not null,
  -- Job id assigned by the queue, for correlating logs.
  queue_job_id text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  entity_type public.entity_type,
  entity_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_runs_entity_check check ((entity_type is null) = (entity_id is null)),
  constraint job_runs_finished_check check (finished_at is null or started_at is not null)
);
create index job_runs_company_status_idx on public.job_runs (company_id, status, created_at desc);
create index job_runs_queue_job_idx on public.job_runs (queue, queue_job_id) where queue_job_id is not null;
create index job_runs_entity_idx on public.job_runs (company_id, entity_type, entity_id) where entity_id is not null;

create trigger set_updated_at before update on public.notifications
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.notifications
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.job_runs
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.job_runs
  for each row execute function private.prevent_company_change();
