-- Lifecycle columns agree with the status in both directions.
--
-- * monitoring_events: reopening a resolved event kept resolved_at / resolved_by_user_id, so an open
--   event reported when and by whom it was resolved. stamp_event_status now clears them whenever the
--   status is not 'resolved' (resolution_notes are kept: notes are written on other transitions too).
--   The resolver is not required on a resolved row: system and service-role resolutions have none.
-- * notifications: read = true with read_at NULL was accepted.
-- * statements: a verified statement moved back to another status kept its verifier and time.
--
-- The existing triggers (stamp_status, stamp_verification) keep pointing at the replaced functions.

create or replace function private.stamp_event_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'dismissed' then
    new.dismissed_by_user_id := coalesce((select auth.uid()), new.dismissed_by_user_id);
    new.dismissed_at := case when (select auth.uid()) is null then coalesce(new.dismissed_at, now()) else now() end;
  else
    new.dismissal_reason := null;
    new.dismissed_by_user_id := null;
    new.dismissed_at := null;
  end if;
  if new.status = 'resolved' then
    new.resolved_by_user_id := coalesce((select auth.uid()), new.resolved_by_user_id);
    new.resolved_at := case when (select auth.uid()) is null then coalesce(new.resolved_at, now()) else now() end;
  else
    new.resolved_by_user_id := null;
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create or replace function private.stamp_statement_verification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'verified' and old.status <> 'verified' and (select auth.uid()) is not null then
    new.verified_by_user_id := (select auth.uid());
    new.verified_at := now();
  elsif new.status <> 'verified' then
    new.verified_by_user_id := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

alter table public.monitoring_events
  drop constraint monitoring_events_resolution_check,
  add constraint monitoring_events_resolution_check check (
    (status = 'resolved') = (resolved_at is not null)
    and (status = 'resolved' or resolved_by_user_id is null)
  );

alter table public.notifications
  drop constraint notifications_read_check,
  add constraint notifications_read_check check (read = (read_at is not null));

alter table public.statements
  add constraint statements_verifier_check check (
    status = 'verified' or (verified_by_user_id is null and verified_at is null)
  );
