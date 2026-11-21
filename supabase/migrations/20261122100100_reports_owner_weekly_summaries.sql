-- Reports: the weekly owner portfolio summary (ticket R-07, ADR 0003).
--
-- The reports service owns this table and these functions. Its HTTP process previews each owner's summary for a
-- company admin with the caller's own token (Row Level Security). Its worker process (services/reports/src/worker.ts)
-- computes and stores every owner's summary on the company's owner summary day, with the service role, and hands each
-- one to the core messaging pipeline on the `owner-summary-delivery` queue; the core records and sends the message
-- (20261122100000_owner_weekly_summary_messages.sql). The reports service never calls Meta.
--
--   * private.reports_require_member lets the service role through: the reports worker names the company itself, as
--     the core worker does (the service role bypasses Row Level Security, so every function filters by company).
--     Signed-in callers are checked exactly as before.
--   * The reporting functions the summary is computed from are granted to the service role as well.
--   * public.reports_owner_summaries: one stored summary per company, owner and week (the Monday), with its figures
--     (the domain's OwnerWeeklySummary as JSON), the outstanding total the next week's "change since" is worked out
--     from, the template values, and whether it was handed over to the messaging pipeline or blocked (and why). Only the
--     reports worker writes it; a summary handed over is final. Company admins read their company's.
--   * public.reports_owner_summary_owners: the owners of the company's properties that are not archived, with their
--     status, role, WhatsApp number and properties.
--   * public.reports_owner_summary_channel: the template chosen for owner_weekly_summary (as Settings → Message
--     templates reads it, with Meta's own status and text), whether a number is connected and the company's day.
--   * public.reports_owner_summaries_stored: per owner, the week's stored summary with its message's delivery status
--     (message history), and the previous week's outstanding total.
--   * public.reports_owner_summary_message (service role): the stored summary the core worker records and sends.
--   * public.reports_owner_summary_companies (service role): the active companies and their owner summary day.

-- --------------------------------------------------------------------------- the worker's access
create or replace function private.reports_require_member(p_company_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  -- The reports worker (service role) computes the weekly owner summaries; it names the company explicitly.
  if current_user = 'service_role' then
    if p_company_id is null then
      raise exception 'Name the company to read its reports' using errcode = '42501';
    end if;
    return;
  end if;
  if (select auth.uid()) is null or p_company_id is null or not (p_company_id = any (private.member_company_ids())) then
    raise exception 'Only members of the company can read its reports' using errcode = '42501';
  end if;
end;
$$;
grant execute on function private.reports_require_member(uuid) to service_role;

grant execute on function public.reports_arrears_accounts(uuid) to service_role;
grant execute on function public.reports_arrears_detail(uuid) to service_role;
grant execute on function public.reports_payment_arrangements(uuid) to service_role;
grant execute on function public.reports_arrears_settings(uuid) to service_role;
grant execute on function public.reports_monitoring_events(uuid) to service_role;
grant execute on function public.reports_rental_comparisons(uuid) to service_role;
grant execute on function public.reports_discrepancy_rule(uuid) to service_role;
grant execute on function public.reports_lease_security(uuid) to service_role;
grant execute on function public.reports_guarantee_notice_days(uuid) to service_role;

-- --------------------------------------------------------------------------- stored summaries
create table public.reports_owner_summaries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  owner_user_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  as_of date not null,
  total_outstanding numeric(14, 2) not null,
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  template_values text[] not null check (cardinality(template_values) = 3),
  status text not null check (status in ('ready', 'blocked', 'handed_over')),
  blockers text[] not null default '{}',
  computed_at timestamptz not null default now(),
  handed_over_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_owner_summaries_company_id_key unique (company_id, id),
  constraint reports_owner_summaries_week_key unique (company_id, owner_user_id, week_start),
  constraint reports_owner_summaries_owner_fk foreign key (company_id, owner_user_id)
    references public.company_users (company_id, user_id) on delete cascade,
  constraint reports_owner_summaries_as_of_check check (as_of >= week_start and as_of < week_start + 7),
  constraint reports_owner_summaries_handed_over_check check ((status = 'handed_over') = (handed_over_at is not null)),
  constraint reports_owner_summaries_blocked_check check ((status = 'blocked') = (cardinality(blockers) > 0))
);
comment on table public.reports_owner_summaries is
  'Reports service (R-07): each property owner''s weekly summary, computed from verified records and stored so the next week''s change is exact. Written only by the reports worker; company admins read.';
create index reports_owner_summaries_owner_idx on public.reports_owner_summaries (company_id, owner_user_id, week_start desc);

create function private.reports_guard_owner_summary()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'handed_over' then
    raise exception 'a weekly owner summary handed over for sending is final' using errcode = '42501';
  end if;
  if (new.company_id, new.owner_user_id, new.week_start) is distinct from (old.company_id, old.owner_user_id, old.week_start) then
    raise exception 'a weekly owner summary stays with its company, owner and week' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_change before update on public.reports_owner_summaries
  for each row execute function private.reports_guard_owner_summary();
create trigger set_updated_at before update on public.reports_owner_summaries
  for each row execute function private.set_updated_at();

alter table public.reports_owner_summaries enable row level security;
revoke all on public.reports_owner_summaries from anon, authenticated;
grant select on public.reports_owner_summaries to authenticated;
grant select, insert, update on public.reports_owner_summaries to service_role;
create policy admins_read on public.reports_owner_summaries for select to authenticated
  using (company_id = any ((select private.company_ids_with_role(array['company_admin']::public.user_role[]))::uuid[]));

-- --------------------------------------------------------------------------- owners
create function public.reports_owner_summary_owners(p_company_id uuid)
returns table (
  owner_user_id uuid,
  owner_name text,
  owner_status public.user_status,
  owner_role public.user_role,
  whatsapp_number text,
  properties jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select
    pr.owner_user_id,
    coalesce(nullif(pf.full_name, ''), pf.email, 'Property owner'),
    pf.status,
    cu.role,
    pf.whatsapp_number,
    jsonb_agg(jsonb_build_object('propertyId', pr.id, 'propertyName', pr.name) order by pr.name, pr.id)
  from public.properties pr
  left join public.profiles pf on pf.id = pr.owner_user_id
  left join public.company_users cu on cu.company_id = p_company_id and cu.user_id = pr.owner_user_id
  where pr.company_id = p_company_id and pr.owner_user_id is not null and pr.status <> 'archived'
  group by pr.owner_user_id, pf.full_name, pf.email, pf.status, cu.role, pf.whatsapp_number
  order by 2, 1;
end;
$$;
revoke all on function public.reports_owner_summary_owners(uuid) from public, anon;
grant execute on function public.reports_owner_summary_owners(uuid) to authenticated, service_role;
comment on function public.reports_owner_summary_owners(uuid) is
  'Reports service (R-07): the owners of the company''s properties that are not archived, with status, role, WhatsApp number and properties. Members only.';

-- --------------------------------------------------------------------------- template and channel
create function public.reports_owner_summary_channel(p_company_id uuid)
returns table (
  owner_summary_weekday public.weekday,
  whatsapp_connected boolean,
  template_id uuid,
  meta_template_name text,
  language text,
  category text,
  body text,
  variables text[],
  approval_status public.template_approval_status,
  supports_document_attachment boolean,
  mapped_at timestamptz,
  meta_template_id uuid,
  meta_status text,
  meta_rejected_reason text,
  meta_body text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select
    co.owner_summary_weekday,
    exists (select 1 from public.whatsapp_phone_numbers n where n.company_id = p_company_id and n.connection_status = 'connected'),
    t.id,
    t.meta_template_name,
    t.language,
    t.category,
    t.body,
    t.variables,
    t.approval_status,
    t.supports_document_attachment,
    m.mapped_at,
    w.id,
    w.status,
    w.rejected_reason,
    w.body
  from public.companies co
  left join public.message_type_templates m on m.company_id = co.id and m.message_type = 'owner_weekly_summary'
  left join public.message_templates t on t.company_id = m.company_id and t.id = m.message_template_id
  left join lateral (
    -- Meta's template with the same name and language, the newest sync first (as Settings → Message templates).
    select s.id, s.status, s.rejected_reason, s.body from public.whatsapp_message_templates s
    where s.company_id = co.id and s.name = t.meta_template_name and s.language = t.language
    order by s.synced_at desc, s.id
    limit 1
  ) w on true
  where co.id = p_company_id;
end;
$$;
revoke all on function public.reports_owner_summary_channel(uuid) from public, anon;
grant execute on function public.reports_owner_summary_channel(uuid) to authenticated, service_role;
comment on function public.reports_owner_summary_channel(uuid) is
  'Reports service (R-07): the company''s owner summary day, whether a WhatsApp number is connected, and the template chosen for owner_weekly_summary with Meta''s status and text. Members only.';

-- --------------------------------------------------------------------------- stored summaries of a week
create function public.reports_owner_summaries_stored(p_company_id uuid, p_week_start date)
returns table (
  owner_user_id uuid,
  summary_id uuid,
  status text,
  blockers text[],
  computed_at timestamptz,
  communication_id uuid,
  delivery_status public.delivery_status,
  failure_reason text,
  sent_at timestamptz,
  previous_week_start date,
  previous_total_outstanding numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  with owners as (
    select distinct s.owner_user_id from public.reports_owner_summaries s
    where s.company_id = p_company_id and s.week_start <= p_week_start
  )
  select
    o.owner_user_id,
    cur.id,
    cur.status,
    cur.blockers,
    cur.computed_at,
    c.id,
    c.status,
    c.failure_reason,
    c.sent_at,
    prev.week_start,
    prev.total_outstanding
  from owners o
  left join public.reports_owner_summaries cur
    on cur.company_id = p_company_id and cur.owner_user_id = o.owner_user_id and cur.week_start = p_week_start
  left join public.communications c
    on c.company_id = p_company_id and c.owner_user_id = o.owner_user_id and c.owner_summary_week = p_week_start
  left join lateral (
    select s.week_start, s.total_outstanding from public.reports_owner_summaries s
    where s.company_id = p_company_id and s.owner_user_id = o.owner_user_id and s.week_start < p_week_start
    order by s.week_start desc
    limit 1
  ) prev on true
  order by o.owner_user_id;
end;
$$;
revoke all on function public.reports_owner_summaries_stored(uuid, date) from public, anon;
grant execute on function public.reports_owner_summaries_stored(uuid, date) to authenticated, service_role;
comment on function public.reports_owner_summaries_stored(uuid, date) is
  'Reports service (R-07): per owner, the week''s stored summary and its message''s delivery status, and the previous stored week''s outstanding total. Company admins see the stored rows (RLS).';

-- --------------------------------------------------------------------------- for the core worker
create function public.reports_owner_summary_message(p_company_id uuid, p_summary_id uuid)
returns table (owner_user_id uuid, week_start date, template_values text[], status text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform private.reports_require_member(p_company_id);

  return query
  select s.owner_user_id, s.week_start, s.template_values, s.status
  from public.reports_owner_summaries s
  where s.company_id = p_company_id and s.id = p_summary_id;
end;
$$;
revoke all on function public.reports_owner_summary_message(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reports_owner_summary_message(uuid, uuid) to service_role;
comment on function public.reports_owner_summary_message(uuid, uuid) is
  'Reports service (R-07): the stored summary the core messaging pipeline records and sends (owner, week, template values). Service role only: the core worker''s read of the reports service''s data.';

-- --------------------------------------------------------------------------- for the weekly dispatch
create function public.reports_owner_summary_companies()
returns table (company_id uuid, owner_summary_weekday public.weekday)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.owner_summary_weekday from public.companies c where c.status = 'active' order by c.id
$$;
revoke all on function public.reports_owner_summary_companies() from public, anon, authenticated;
grant execute on function public.reports_owner_summary_companies() to service_role;
comment on function public.reports_owner_summary_companies() is
  'Reports worker (R-07): the active companies and their owner summary day. Service role only.';
