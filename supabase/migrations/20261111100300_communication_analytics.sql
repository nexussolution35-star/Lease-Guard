-- Communication analytics per company (ticket 12).
--
-- public.communication_analytics(company, from, to): a company's WhatsApp figures over South African calendar days,
-- both inclusive (Africa/Johannesburg, the only zone LeaseGuard operates in):
-- * messages, on the day they were recorded (created_at) and by their current status: inbound; outbound handed to
--   WhatsApp for sending (queued, sent, delivered, read or failed; not drafts, approval requests or rejected ones);
--   of those delivered (read included), read and failed. Other channels (email, system) do not count, and test
--   messages are not communications;
-- * handovers opened that day, and how many the AI agent opened;
-- * AI agent runs started that day (one per inbound message): answers sent, out-of-hours messages sent, and suggested
--   replies drafted for staff (internal, never sent).
-- Security invoker: it reads as the caller, so Row Level Security applies to every table it counts. It also refuses
-- (42501) anyone who is not an active member of the company, so another company's id never returns zeros that look
-- like an answer. A range is at most 366 days (22023 otherwise).

-- Counting a company's handovers and agent runs over a period.
create index whatsapp_handovers_company_created_idx on public.whatsapp_handovers (company_id, created_at);
create index whatsapp_agent_runs_company_created_idx on public.whatsapp_agent_runs (company_id, created_at);

create function public.communication_analytics(p_company_id uuid, p_from date, p_to date)
returns table (
  inbound_messages bigint,
  outbound_messages bigint,
  delivered_messages bigint,
  read_messages bigint,
  failed_messages bigint,
  handovers_opened bigint,
  handovers_by_agent bigint,
  agent_replies bigint,
  out_of_hours_messages bigint,
  suggested_replies bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if (select auth.uid()) is null or not (p_company_id = any (private.member_company_ids())) then
    raise exception 'Only members of the company can read its communication analytics' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then
    raise exception 'A start and an end date are required' using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'The end date must be on or after the start date' using errcode = '22023';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception 'A range is at most 366 days' using errcode = '22023';
  end if;

  v_start := p_from::timestamp at time zone 'Africa/Johannesburg';
  v_end := (p_to + 1)::timestamp at time zone 'Africa/Johannesburg';

  return query
  select m.inbound, m.outbound, m.delivered, m.read, m.failed, h.opened, h.by_agent, r.replies, r.out_of_hours, r.suggested
  from (
    select
      count(*) filter (where c.direction = 'inbound') as inbound,
      count(*) filter (where c.direction = 'outbound' and c.status in ('queued', 'sent', 'delivered', 'read', 'failed')) as outbound,
      count(*) filter (where c.direction = 'outbound' and c.status in ('delivered', 'read')) as delivered,
      count(*) filter (where c.direction = 'outbound' and c.status = 'read') as read,
      count(*) filter (where c.direction = 'outbound' and c.status = 'failed') as failed
    from public.communications c
    where c.company_id = p_company_id and c.channel = 'whatsapp' and c.created_at >= v_start and c.created_at < v_end
  ) m
  cross join (
    select count(*) as opened, count(*) filter (where w.requested_by = 'agent') as by_agent
    from public.whatsapp_handovers w
    where w.company_id = p_company_id and w.created_at >= v_start and w.created_at < v_end
  ) h
  cross join (
    select
      count(*) filter (where a.outcome = 'replied') as replies,
      count(*) filter (where a.outcome = 'out_of_hours') as out_of_hours,
      count(*) filter (where a.suggested_reply is not null) as suggested
    from public.whatsapp_agent_runs a
    where a.company_id = p_company_id and a.created_at >= v_start and a.created_at < v_end
  ) r;
end;
$$;
revoke all on function public.communication_analytics(uuid, date, date) from public, anon, service_role;
grant execute on function public.communication_analytics(uuid, date, date) to authenticated;
comment on function public.communication_analytics(uuid, date, date) is
  'Members: the company''s WhatsApp figures over South African calendar days (both inclusive, at most 366): inbound, outbound handed for sending, delivered, read, failed, handovers opened (and by the AI agent), agent answers, out-of-hours messages and suggested replies. Security invoker (RLS applies).';
