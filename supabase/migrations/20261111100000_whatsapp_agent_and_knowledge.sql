-- Each company's AI agent configuration and knowledge base (ticket 09).
--
-- * whatsapp_agent_configs: one row per company (the company id is the key). What the company's AI agent is called,
--   what the business does, its tone, operating hours, languages, policies, support instructions, escalation rules,
--   the actions it may take and whether it may answer contacts on its own (auto_reply_enabled, off by default).
--   Tenants are never answered automatically whatever this says (ADR 0001; enforced by the agent runtime, ticket 10).
-- * whatsapp_agent_handover_contacts: the members (company admins and property managers of the same company) told
--   when the agent hands a conversation to a person.
-- * whatsapp_knowledge_faqs, whatsapp_knowledge_entries, whatsapp_knowledge_documents: the knowledge base. Every item
--   is a draft or approved. A signed-in user always creates a draft; changing an approved item's content returns it to
--   draft, so the agent never uses text nobody approved. Approval records who approved it and when.
-- * Documents live in the private bucket 'agent-knowledge' at <company_id>/<document_id>/<file name>.
-- * public.whatsapp_agent_knowledge(company): the only way the agent runtime (worker, service role) reads all this:
--   one company's configuration, its handover contacts and its APPROVED items only.
--
-- Every member of the company reads all of it (staff answering conversations see what the agent knows); only company
-- admins write it. Saving the configuration and its handover contacts is one call (save_whatsapp_agent_config).

-- ------------------------------------------------------------------ agent configuration
create function private.is_agent_operating_hours(p_hours jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) > 14 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_hours) loop
    if jsonb_typeof(v_item) <> 'object'
       or (select count(*) from jsonb_object_keys(v_item)) <> 3
       or not (v_item ? 'day' and v_item ? 'opens' and v_item ? 'closes')
       or jsonb_typeof(v_item -> 'day') <> 'string' or jsonb_typeof(v_item -> 'opens') <> 'string' or jsonb_typeof(v_item -> 'closes') <> 'string'
       or (v_item ->> 'day') not in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
       or (v_item ->> 'opens') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_item ->> 'closes') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
       or (v_item ->> 'opens') >= (v_item ->> 'closes') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.is_agent_operating_hours(jsonb) from public;
grant execute on function private.is_agent_operating_hours(jsonb) to authenticated, service_role;

create table public.whatsapp_agent_configs (
  company_id uuid primary key references public.companies (id) on delete cascade,
  agent_name text not null check (length(btrim(agent_name)) between 1 and 80),
  business_description text not null default '' check (length(business_description) <= 4000),
  tone text not null default '' check (length(tone) <= 500),
  timezone text not null default 'Africa/Johannesburg' check (timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$' and length(timezone) <= 64),
  -- [{ "day": "monday", "opens": "08:00", "closes": "17:00" }, …] in the timezone above; empty means never open.
  operating_hours jsonb not null default '[]' check (private.is_agent_operating_hours(operating_hours)),
  languages text[] not null default '{en}' check (
    cardinality(languages) between 1 and 11
    and languages <@ array['en', 'af', 'zu', 'xh', 'st', 'tn', 'nso', 'ts', 'ss', 've', 'nr']
  ),
  policies text not null default '' check (length(policies) <= 8000),
  support_instructions text not null default '' check (length(support_instructions) <= 8000),
  escalation_rules text not null default '' check (length(escalation_rules) <= 8000),
  -- What the agent may do. draft_tenant_reply only ever drafts an internal suggestion; nothing is sent to a tenant.
  permitted_actions text[] not null default '{}' check (
    permitted_actions <@ array['answer_faq', 'share_business_info', 'share_approved_document', 'capture_enquiry', 'draft_tenant_reply']
  ),
  auto_reply_enabled boolean not null default false,
  out_of_hours_message text check (out_of_hours_message is null or length(btrim(out_of_hours_message)) between 1 and 1000),
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_agent_configs_updated_by_fk foreign key (company_id, updated_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (updated_by_user_id)
);
comment on table public.whatsapp_agent_configs is
  'One AI agent configuration per company. Members read; company admins write (save_whatsapp_agent_config). The agent runtime reads it through whatsapp_agent_knowledge(). Tenants are never answered automatically whatever it says.';
create index whatsapp_agent_configs_updated_by_idx on public.whatsapp_agent_configs (company_id, updated_by_user_id) where updated_by_user_id is not null;
create trigger set_updated_at before update on public.whatsapp_agent_configs
  for each row execute function private.set_updated_at();
-- Who saved it last: the caller, never a value the client sent (the service role keeps what it supplies).
create function private.stamp_agent_config_editor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by_user_id := coalesce((select auth.uid()), new.updated_by_user_id);
  return new;
end;
$$;
revoke all on function private.stamp_agent_config_editor() from public;
create trigger stamp_editor before insert or update on public.whatsapp_agent_configs
  for each row execute function private.stamp_agent_config_editor();
create trigger prevent_company_change before update on public.whatsapp_agent_configs
  for each row execute function private.prevent_company_change();

create table public.whatsapp_agent_handover_contacts (
  company_id uuid not null references public.whatsapp_agent_configs (company_id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id),
  -- A member of the same company; leaving the company removes them from the list.
  constraint whatsapp_agent_handover_contacts_member_fk foreign key (company_id, user_id)
    references public.company_users (company_id, user_id) on delete cascade
);
comment on table public.whatsapp_agent_handover_contacts is
  'Members told when the company''s AI agent hands a conversation to a person. Written with the configuration (save_whatsapp_agent_config).';
create trigger prevent_company_change before update on public.whatsapp_agent_handover_contacts
  for each row execute function private.prevent_company_change();

-- ------------------------------------------------------------------ knowledge base
create table public.whatsapp_knowledge_faqs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  question text not null check (length(btrim(question)) between 1 and 500),
  answer text not null check (length(btrim(answer)) between 1 and 4000),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_at timestamptz,
  approved_by_user_id uuid,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_knowledge_faqs_company_id_key unique (company_id, id),
  constraint whatsapp_knowledge_faqs_approved_check check ((status = 'approved') = (approved_at is not null)),
  constraint whatsapp_knowledge_faqs_approved_by_fk foreign key (company_id, approved_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (approved_by_user_id),
  constraint whatsapp_knowledge_faqs_created_by_fk foreign key (company_id, created_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (created_by_user_id)
);

create table public.whatsapp_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  content text not null check (length(btrim(content)) between 1 and 10000),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_at timestamptz,
  approved_by_user_id uuid,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_knowledge_entries_company_id_key unique (company_id, id),
  constraint whatsapp_knowledge_entries_approved_check check ((status = 'approved') = (approved_at is not null)),
  constraint whatsapp_knowledge_entries_approved_by_fk foreign key (company_id, approved_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (approved_by_user_id),
  constraint whatsapp_knowledge_entries_created_by_fk foreign key (company_id, created_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (created_by_user_id)
);

create table public.whatsapp_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 1000),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  -- <company_id>/<this document's id>/<safe file name> in the 'agent-knowledge' bucket.
  storage_path text not null unique check (
    private.is_storage_object_path(storage_path, company_id) and split_part(storage_path, '/', 2) = id::text
  ),
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_at timestamptz,
  approved_by_user_id uuid,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_knowledge_documents_company_id_key unique (company_id, id),
  constraint whatsapp_knowledge_documents_approved_check check ((status = 'approved') = (approved_at is not null)),
  constraint whatsapp_knowledge_documents_approved_by_fk foreign key (company_id, approved_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (approved_by_user_id),
  constraint whatsapp_knowledge_documents_created_by_fk foreign key (company_id, created_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (created_by_user_id)
);

-- Draft and approved: a signed-in user's new item is a draft; changing an approved item's content makes it a draft
-- again; approving stamps the approver and time (the caller, never a value the client sent). The service role (no
-- auth.uid()) keeps what it supplies, like the other stamping triggers.
create function private.knowledge_review_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_bookkeeping text[] := array['status', 'approved_at', 'approved_by_user_id', 'created_by_user_id', 'created_at', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.status := 'draft';
      new.approved_at := null;
      new.approved_by_user_id := null;
      new.created_by_user_id := v_actor;
    end if;
    return new;
  end if;

  new.created_by_user_id := old.created_by_user_id;
  if (to_jsonb(new) - v_bookkeeping) is distinct from (to_jsonb(old) - v_bookkeeping) then
    -- New content needs a new approval.
    new.status := 'draft';
  end if;
  if new.status = 'approved' and old.status = 'approved' then
    new.approved_at := old.approved_at;
    new.approved_by_user_id := old.approved_by_user_id;
  elsif new.status = 'approved' then
    new.approved_at := case when v_actor is null then coalesce(new.approved_at, now()) else now() end;
    new.approved_by_user_id := coalesce(v_actor, new.approved_by_user_id);
  else
    new.approved_at := null;
    new.approved_by_user_id := null;
  end if;
  return new;
end;
$$;
revoke all on function private.knowledge_review_state() from public;

-- Audit trail: approving knowledge and saving the agent configuration (entity: the company).
create function private.audit_knowledge_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := case tg_table_name
    when 'whatsapp_knowledge_faqs' then format('the FAQ "%s"', left(to_jsonb(new) ->> 'question', 80))
    when 'whatsapp_knowledge_entries' then format('the knowledge entry "%s"', left(to_jsonb(new) ->> 'title', 80))
    else format('the knowledge document "%s"', left(to_jsonb(new) ->> 'title', 80))
  end;
begin
  perform private.write_audit(
    new.company_id, 'approve', 'company', new.company_id,
    format('Approved %s for the AI agent', v_label),
    jsonb_build_array(private.field_change('knowledgeStatus', old.status, new.status))
  );
  return null;
end;
$$;
revoke all on function private.audit_knowledge_approval() from public;

do $$
declare
  t text;
begin
  foreach t in array array['whatsapp_knowledge_faqs', 'whatsapp_knowledge_entries', 'whatsapp_knowledge_documents'] loop
    execute format('create index %I on public.%I (company_id, created_at)', t || '_company_created_idx', t);
    execute format('create index %I on public.%I (company_id, approved_by_user_id) where approved_by_user_id is not null', t || '_approved_by_idx', t);
    execute format('create index %I on public.%I (company_id, created_by_user_id) where created_by_user_id is not null', t || '_created_by_idx', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', t);
    execute format('create trigger prevent_company_change before update on public.%I for each row execute function private.prevent_company_change()', t);
    execute format('create trigger review_state before insert or update on public.%I for each row execute function private.knowledge_review_state()', t);
    execute format(
      'create trigger audit_approval after update of status on public.%I for each row when (old.status is distinct from new.status and new.status = ''approved'') execute function private.audit_knowledge_approval()',
      t);
  end loop;
end;
$$;
comment on table public.whatsapp_knowledge_faqs is
  'A company''s frequently asked questions for its AI agent, draft or approved. Only approved ones reach the agent (whatsapp_agent_knowledge). Members read; company admins write.';
comment on table public.whatsapp_knowledge_entries is
  'A company''s knowledge entries (title and text) for its AI agent, draft or approved. Only approved ones reach the agent. Members read; company admins write.';
comment on table public.whatsapp_knowledge_documents is
  'Documents in the agent-knowledge bucket the AI agent may refer to, draft or approved. Only approved ones reach the agent. Members read; company admins write.';

-- Audit a configuration save (insert or update) once per statement row.
create function private.audit_agent_config()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.write_audit(
    new.company_id, case when tg_op = 'INSERT' then 'create' else 'update' end, 'company', new.company_id,
    case when tg_op = 'INSERT' then 'Set up the AI agent' else 'Updated the AI agent settings' end,
    case when tg_op = 'UPDATE' and old.auto_reply_enabled is distinct from new.auto_reply_enabled
      then jsonb_build_array(private.field_change('agentAutoReply', old.auto_reply_enabled, new.auto_reply_enabled))
      else '[]'::jsonb end
  );
  return null;
end;
$$;
revoke all on function private.audit_agent_config() from public;
create trigger audit_change after insert or update on public.whatsapp_agent_configs
  for each row execute function private.audit_agent_config();

-- ------------------------------------------------------------------ privileges and RLS
do $$
declare
  t text;
  member text := 'company_id = any ((select private.member_company_ids())::uuid[])';
  admin text := 'company_id = any ((select private.company_ids_with_role(''{company_admin}''))::uuid[])';
begin
  foreach t in array array[
    'whatsapp_agent_configs', 'whatsapp_agent_handover_contacts',
    'whatsapp_knowledge_faqs', 'whatsapp_knowledge_entries', 'whatsapp_knowledge_documents'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('create policy members_read on public.%I for select to authenticated using (%s)', t, member);
    execute format('create policy admins_insert on public.%I for insert to authenticated with check (%s)', t, admin);
    execute format('create policy admins_update on public.%I for update to authenticated using (%s) with check (%s)', t, admin, admin);
    execute format('create policy admins_delete on public.%I for delete to authenticated using (%s)', t, admin);
  end loop;
end;
$$;
-- Approval and authorship are stamped by the trigger; a client never writes them directly.
revoke insert, update on public.whatsapp_knowledge_faqs, public.whatsapp_knowledge_entries, public.whatsapp_knowledge_documents from authenticated;
grant insert (company_id, question, answer) on public.whatsapp_knowledge_faqs to authenticated;
grant update (question, answer, status) on public.whatsapp_knowledge_faqs to authenticated;
grant insert (company_id, title, content) on public.whatsapp_knowledge_entries to authenticated;
grant update (title, content, status) on public.whatsapp_knowledge_entries to authenticated;
grant insert (id, company_id, title, description, file_name, storage_path, mime_type, size_bytes) on public.whatsapp_knowledge_documents to authenticated;
grant update (title, description, status) on public.whatsapp_knowledge_documents to authenticated;
revoke update on public.whatsapp_agent_handover_contacts from authenticated;

-- ------------------------------------------------------------------ save the configuration
-- Company admins. Creates or replaces the configuration and its handover contacts in one transaction. Runs as the
-- caller (RLS: company admins only). p_config holds the snake_case columns; omitted ones take their defaults.
-- Every handover contact must be an active company admin or property manager of the company (22023 otherwise).
create function public.save_whatsapp_agent_config(p_company_id uuid, p_config jsonb, p_handover_user_ids uuid[])
returns public.whatsapp_agent_configs
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_saved public.whatsapp_agent_configs;
  v_ids uuid[] := coalesce((select array_agg(distinct u) from unnest(p_handover_user_ids) u where u is not null), '{}');
begin
  if not (p_company_id = any (private.company_ids_with_role('{company_admin}'))) then
    raise exception 'only company admins configure the AI agent' using errcode = '42501';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'the configuration must be an object' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 20 then
    raise exception 'at most 20 handover contacts' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) u
    where not exists (
      select 1 from public.company_users cu join public.profiles p on p.id = cu.user_id
      where cu.company_id = p_company_id and cu.user_id = u
        and cu.role in ('company_admin', 'property_manager') and p.status = 'active'
    )
  ) then
    raise exception 'handover contacts must be active company admins or property managers of the company' using errcode = '22023';
  end if;

  insert into public.whatsapp_agent_configs as c (
    company_id, agent_name, business_description, tone, timezone, operating_hours, languages, policies,
    support_instructions, escalation_rules, permitted_actions, auto_reply_enabled, out_of_hours_message, updated_by_user_id
  )
  select p_company_id, r.agent_name, coalesce(r.business_description, ''), coalesce(r.tone, ''),
         coalesce(r.timezone, 'Africa/Johannesburg'), coalesce(r.operating_hours, '[]'), coalesce(r.languages, '{en}'),
         coalesce(r.policies, ''), coalesce(r.support_instructions, ''), coalesce(r.escalation_rules, ''),
         coalesce(r.permitted_actions, '{}'), coalesce(r.auto_reply_enabled, false), r.out_of_hours_message, (select auth.uid())
  from jsonb_populate_record(null::public.whatsapp_agent_configs, p_config) r
  on conflict (company_id) do update set
    agent_name = excluded.agent_name,
    business_description = excluded.business_description,
    tone = excluded.tone,
    timezone = excluded.timezone,
    operating_hours = excluded.operating_hours,
    languages = excluded.languages,
    policies = excluded.policies,
    support_instructions = excluded.support_instructions,
    escalation_rules = excluded.escalation_rules,
    permitted_actions = excluded.permitted_actions,
    auto_reply_enabled = excluded.auto_reply_enabled,
    out_of_hours_message = excluded.out_of_hours_message,
    updated_by_user_id = excluded.updated_by_user_id
  returning * into v_saved;

  delete from public.whatsapp_agent_handover_contacts h
  where h.company_id = p_company_id and not (h.user_id = any (v_ids));
  insert into public.whatsapp_agent_handover_contacts (company_id, user_id)
  select p_company_id, u from unnest(v_ids) u
  on conflict do nothing;

  return v_saved;
end;
$$;
revoke all on function public.save_whatsapp_agent_config(uuid, jsonb, uuid[]) from public, anon, service_role;
grant execute on function public.save_whatsapp_agent_config(uuid, jsonb, uuid[]) to authenticated;
comment on function public.save_whatsapp_agent_config(uuid, jsonb, uuid[]) is
  'Company admins. Create or replace the company''s AI agent configuration and its handover contacts (active company admins or property managers of the company).';

-- ------------------------------------------------------------------ what the agent runtime may read
-- The agent runtime (worker, service role) reads one company's agent through this function only: its configuration,
-- its handover contacts who are still active writers, and its APPROVED knowledge. Drafts and other companies' rows
-- are never returned. Security invoker: the service role reads past RLS, so the company filter is explicit.
create function public.whatsapp_agent_knowledge(p_company_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'companyId', p_company_id,
    'config', (
      select jsonb_build_object(
        'agentName', c.agent_name, 'businessDescription', c.business_description, 'tone', c.tone,
        'timezone', c.timezone, 'operatingHours', c.operating_hours, 'languages', to_jsonb(c.languages),
        'policies', c.policies, 'supportInstructions', c.support_instructions, 'escalationRules', c.escalation_rules,
        'permittedActions', to_jsonb(c.permitted_actions), 'autoReplyEnabled', c.auto_reply_enabled,
        'outOfHoursMessage', c.out_of_hours_message, 'updatedAt', c.updated_at)
      from public.whatsapp_agent_configs c where c.company_id = p_company_id
    ),
    'handoverContactUserIds', coalesce((
      select jsonb_agg(h.user_id order by h.created_at, h.user_id)
      from public.whatsapp_agent_handover_contacts h
      join public.company_users cu on cu.company_id = h.company_id and cu.user_id = h.user_id
      join public.profiles p on p.id = h.user_id
      where h.company_id = p_company_id and cu.role in ('company_admin', 'property_manager') and p.status = 'active'
    ), '[]'::jsonb),
    'faqs', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer) order by f.created_at, f.id)
      from public.whatsapp_knowledge_faqs f where f.company_id = p_company_id and f.status = 'approved'
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'content', e.content) order by e.created_at, e.id)
      from public.whatsapp_knowledge_entries e where e.company_id = p_company_id and e.status = 'approved'
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'description', d.description, 'fileName', d.file_name,
                                          'storagePath', d.storage_path, 'mimeType', d.mime_type) order by d.created_at, d.id)
      from public.whatsapp_knowledge_documents d where d.company_id = p_company_id and d.status = 'approved'
    ), '[]'::jsonb)
  )
$$;
revoke all on function public.whatsapp_agent_knowledge(uuid) from public, anon, authenticated;
grant execute on function public.whatsapp_agent_knowledge(uuid) to service_role;
comment on function public.whatsapp_agent_knowledge(uuid) is
  'Service role (the agent runtime). One company''s AI agent configuration, active handover contacts and approved knowledge only.';

-- ------------------------------------------------------------------ storage: agent-knowledge bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-knowledge', 'agent-knowledge', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy agent_knowledge_members_read on storage.objects for select to authenticated
  using (
    bucket_id = 'agent-knowledge'
    and private.storage_company_id(name) = any ((select private.member_company_ids())::uuid[])
  );
create policy agent_knowledge_admins_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'agent-knowledge'
    and private.is_storage_object_path(name, private.storage_company_id(name))
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin}'))::uuid[])
  );
create policy agent_knowledge_admins_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'agent-knowledge'
    and private.storage_company_id(name) = any ((select private.company_ids_with_role('{company_admin}'))::uuid[])
  );
