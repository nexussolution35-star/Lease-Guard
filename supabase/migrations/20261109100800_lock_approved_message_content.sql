-- An approval covers the message as it was approved.
--
-- Once a message is approved (and while it is queued, sent, delivered, read or failed), signed-in
-- users can no longer change what is sent or to whom, and cannot move it back to draft or
-- pending_approval, which would let it be edited and released again under the old approval.
-- Delivery status updates are made by the worker with the service role, which this guard does not
-- restrict. Rejected messages stay editable so they can be corrected and submitted again.

create function private.guard_approved_message_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated'
     or old.status not in ('approved', 'queued', 'sent', 'delivered', 'read', 'failed') then
    return new;
  end if;

  if new.status in ('draft', 'pending_approval') then
    raise exception 'an approved message cannot be returned to %; create a new message instead', new.status
      using errcode = '42501';
  end if;

  if (new.channel, new.direction, new.message_type, new.recipient_type, new.tenant_id, new.owner_user_id,
      new.counterparty_number, new.company_number, new.body, new.template_id,
      new.attachment_file_name, new.attachment_storage_path, new.attachment_mime_type,
      new.attachment_size_bytes, new.attachment_sha256)
     is distinct from
     (old.channel, old.direction, old.message_type, old.recipient_type, old.tenant_id, old.owner_user_id,
      old.counterparty_number, old.company_number, old.body, old.template_id,
      old.attachment_file_name, old.attachment_storage_path, old.attachment_mime_type,
      old.attachment_size_bytes, old.attachment_sha256) then
    raise exception 'the content and recipient of an approved message cannot be changed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_approved_message_content() from public;

create trigger guard_approved_content before update on public.communications
  for each row execute function private.guard_approved_message_content();
