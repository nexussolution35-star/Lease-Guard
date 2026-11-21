-- The monitoring event workflow is enforced by the database (module 7 acceptance).
--
-- Until now company writers held UPDATE on every column of `monitoring_events` (and the writers_update policy), so
-- through the Data API a property manager could move an event backwards (new -> dismissed -> new), reopen a resolved or
-- dismissed event, wipe a dismissal reason, or rewrite the title, description and calculation, the last ones without
-- an audit row. The API's PATCH /monitoring/events/{id}/status applied the workflow, but nothing below it did.
--
--   * Signed-in callers no longer UPDATE `monitoring_events` at all (the table grant and the writers_update policy are
--     withdrawn). The app never updated any other column directly: the assignee is set when a job raises the event.
--     Members still read; writers still insert and delete as before (unchanged here).
--   * A status change goes through `public.update_monitoring_event_status` (SECURITY DEFINER, company admins and
--     property managers only, 42501 otherwise). It locks the event and allows exactly the moves of `EVENT_TRANSITIONS`
--     in @leaseguard/domain (rules/monitoringWorkflow.ts), through `private.monitoring_event_transition_allowed`:
--     new -> under_review -> action_required -> in_progress -> resolved, and any open status -> dismissed; resolved and
--     dismissed are final. A refused move is P0001 naming both statuses; dismissing without a reason, or a note over
--     2000 characters (`EVENT_STATUS_NOTE_MAX_LENGTH`), is 22023; another company's or an unknown event is P0002.
--   * The note becomes the dismissal reason when dismissing, otherwise the resolution notes (kept when no note is
--     given). The existing triggers still stamp who resolved or dismissed it and when (`private.stamp_event_status`)
--     and write the history row with the note (`private.audit_event_status`).
--   * Background jobs write with the service role, which keeps its full privileges and is unaffected. The database's
--     own SECURITY DEFINER paths (e.g. `private.resolve_statement_review_event` when a statement review ends) are
--     unaffected too.

-- --------------------------------------------------------------------------- privileges

drop policy writers_update on public.monitoring_events;
revoke update on public.monitoring_events from authenticated;

-- --------------------------------------------------------------------------- workflow

-- The moves a person may make (the same as EVENT_TRANSITIONS in @leaseguard/domain).
create function private.monitoring_event_transition_allowed(
  p_from public.monitoring_event_status,
  p_to public.monitoring_event_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_from
    when 'new' then p_to in ('under_review', 'dismissed')
    when 'under_review' then p_to in ('action_required', 'dismissed')
    when 'action_required' then p_to in ('in_progress', 'dismissed')
    when 'in_progress' then p_to in ('resolved', 'dismissed')
    else false
  end, false)
$$;
revoke all on function private.monitoring_event_transition_allowed(public.monitoring_event_status, public.monitoring_event_status)
  from public, anon, authenticated;

create function public.update_monitoring_event_status(
  p_company_id uuid,
  p_event_id uuid,
  p_status public.monitoring_event_status,
  p_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event public.monitoring_events;
  v_note constant text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if (select auth.uid()) is null or not private.can_write(p_company_id) then
    raise exception 'Only company admins and property managers can change a monitoring event' using errcode = '42501';
  end if;
  if p_status is null then
    raise exception 'Say which status the event moves to.' using errcode = '22023';
  end if;
  if p_status = 'dismissed' and v_note is null then
    raise exception 'Give the reason for dismissing the event.' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 2000 then
    raise exception 'The note can be at most 2000 characters.' using errcode = '22023';
  end if;

  select * into v_event from public.monitoring_events e where e.company_id = p_company_id and e.id = p_event_id for update;
  if not found then
    raise exception 'The monitoring event is not in this workspace' using errcode = 'P0002';
  end if;
  if not private.monitoring_event_transition_allowed(v_event.status, p_status) then
    raise exception 'An event cannot move from "%" to "%".', replace(v_event.status::text, '_', ' '), replace(p_status::text, '_', ' ')
      using errcode = 'P0001';
  end if;

  -- The triggers stamp who resolved or dismissed it and when, and write the history row with the note.
  update public.monitoring_events e set
    status = p_status,
    dismissal_reason = case when p_status = 'dismissed' then v_note else e.dismissal_reason end,
    resolution_notes = case when p_status <> 'dismissed' and v_note is not null then v_note else e.resolution_notes end
  where e.company_id = p_company_id and e.id = p_event_id;
  return p_event_id;
end;
$$;
revoke all on function public.update_monitoring_event_status(uuid, uuid, public.monitoring_event_status, text) from public, anon;
grant execute on function public.update_monitoring_event_status(uuid, uuid, public.monitoring_event_status, text) to authenticated;
comment on function public.update_monitoring_event_status(uuid, uuid, public.monitoring_event_status, text) is
  'A company writer moves a monitoring event along its workflow (new -> under review -> action required -> in progress '
  '-> resolved; any open status -> dismissed; resolved and dismissed are final). The note is the dismissal reason '
  '(required to dismiss) or the resolution notes. Stamps who and when; audited with the note. P0001 for a move the '
  'workflow does not allow, 22023 for a missing reason or a note over 2000 characters, P0002 for another company''s event.';
