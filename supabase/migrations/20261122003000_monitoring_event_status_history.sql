-- Monitoring event history (M7-02): every status change already writes an audit row
-- (private.audit_event_status, 20261107100900_audit_triggers.sql), but the row only recorded the status. The note a
-- person gives with a change (resolution notes, or the dismissal reason) was kept on the event alone and overwritten
-- by the next change, so the event's history could not show why each step was taken.
--
-- The audit row now also carries the resolution notes and the dismissal reason whenever the same update changed them,
-- as FieldChange entries ({ field, before, after }) after the status change. The summary text is unchanged. The
-- trigger still fires only on a status change (the API never changes a note without one).

create or replace function private.audit_event_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.company_id,
    case new.status when 'dismissed' then 'dismiss' when 'resolved' then 'resolve' else 'update' end,
    'monitoring_event',
    new.id,
    case new.status
      when 'dismissed' then format('Dismissed monitoring event "%s": %s', new.title, new.dismissal_reason)
      else format('Monitoring event "%s" %s → %s', new.title, old.status, new.status)
    end,
    jsonb_build_array(private.field_change('status', old.status, new.status))
      || case when new.resolution_notes is distinct from old.resolution_notes
           then jsonb_build_array(private.field_change('resolution_notes', old.resolution_notes, new.resolution_notes))
           else '[]'::jsonb end
      || case when new.dismissal_reason is distinct from old.dismissal_reason
           then jsonb_build_array(private.field_change('dismissal_reason', old.dismissal_reason, new.dismissal_reason))
           else '[]'::jsonb end
  );
  return null;
end;
$$;
