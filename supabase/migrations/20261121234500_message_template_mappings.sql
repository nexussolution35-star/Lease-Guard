-- Settings → Message templates (ticket SG-01): a company admin chooses which Meta-approved WhatsApp template sends each
-- LeaseGuard message type.
--
--   * `whatsapp_message_templates` also keeps Meta's text of each template (`body`, the BODY component) and its header
--     format (`header_format`; a DOCUMENT header carries the statement PDF). The worker's sync stores them
--     (`sync_whatsapp_message_templates`, redefined here with the same grants and status mapping).
--   * `message_type_templates` maps a message type of the company to its `message_templates` row (one per type; a
--     template serves one type). Only the five tenant types and the owner types are templated: inbound replies and
--     manual messages are not.
--   * Signed-in callers no longer write `message_templates` directly (INSERT, UPDATE, DELETE and the writer policies
--     are withdrawn; members still read): a company admin maps through `public.set_message_type_template` (SECURITY
--     DEFINER, 42501 for anyone else), which copies the synced Meta template into `message_templates` and points the
--     type at it. Its rules: Meta has approved the template; not an authentication template; a tenant type uses a
--     Utility template; LeaseGuard holds its text, with numbered placeholders {{1}}…{{n}} and no gaps; the template
--     does not already send another type.
--   * Content guard on `message_templates` (every role, 23514): no banking details for any audience (LeaseGuard never
--     collects payments), and for the tenant audience none of the forbidden topics (escalation, lease expiry, renewal,
--     dispute, guarantee, deposit). The keyword lists mirror FORBIDDEN_TOPIC_PATTERNS and the bank keywords of
--     @leaseguard/domain (messageContent.ts), which the API checks first.
--   * A mapped template's message type is fixed while it is mapped; the mapping's type is the template's.
--   * Choosing a template for a type is audited on the template (entity `message_template`): who, when, the type and
--     the template before and after.
--   * Nothing here sends a message: the outbound gate keeps refusing a template Meta has not approved.

-- --------------------------------------------------------------------------- Meta's text of each template

alter table public.whatsapp_message_templates
  add column body text check (body is null or length(body) between 1 and 4096),
  add column header_format text check (header_format is null or header_format in ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'));
comment on column public.whatsapp_message_templates.body is
  'Meta''s BODY text of the template with its numbered placeholders, as last synced; null when synced before LeaseGuard read template text.';
comment on column public.whatsapp_message_templates.header_format is
  'Meta''s HEADER format (TEXT, IMAGE, VIDEO, DOCUMENT, LOCATION); DOCUMENT carries the statement PDF. Null without a header.';

-- Same function and grants as 20261110101000, also storing body and header_format (absent fields are null).
create or replace function public.sync_whatsapp_message_templates(p_company_id uuid, p_business_account_id text, p_templates jsonb)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_templates) is distinct from 'array' then
    raise exception 'Templates must be a JSON array' using errcode = '22023';
  end if;

  create temporary table if not exists pg_temp.synced_templates (
    meta_template_id text, name text, language text, category text, status text, rejected_reason text,
    body text, header_format text
  ) on commit drop;
  truncate pg_temp.synced_templates;
  insert into pg_temp.synced_templates
  select t.id, t.name, t.language, upper(t.category), upper(t.status),
         nullif(left(nullif(t.rejected_reason, 'NONE'), 200), ''),
         case when length(t.body) between 1 and 4096 then t.body end,
         case when upper(t.header_format) in ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION') then upper(t.header_format) end
  from jsonb_to_recordset(p_templates) as t (
    id text, name text, language text, category text, status text, rejected_reason text, body text, header_format text
  );

  insert into public.whatsapp_message_templates as w
    (company_id, business_account_id, meta_template_id, name, language, category, status, rejected_reason, body, header_format, synced_at)
  select p_company_id, p_business_account_id, t.meta_template_id, t.name, t.language, t.category, t.status, t.rejected_reason,
         t.body, t.header_format, now()
  from pg_temp.synced_templates t
  on conflict (company_id, business_account_id, meta_template_id) do update
  set name = excluded.name, language = excluded.language, category = excluded.category, status = excluded.status,
      rejected_reason = excluded.rejected_reason, body = excluded.body, header_format = excluded.header_format,
      synced_at = excluded.synced_at;

  delete from public.whatsapp_message_templates w
  where w.company_id = p_company_id and w.business_account_id = p_business_account_id
    and not exists (select 1 from pg_temp.synced_templates t where t.meta_template_id = w.meta_template_id);

  update public.message_templates m
  set approval_status = private.whatsapp_template_approval(t.status)
  from pg_temp.synced_templates t
  where m.company_id = p_company_id and m.meta_template_name = t.name and m.language = t.language
    and m.approval_status is distinct from private.whatsapp_template_approval(t.status);

  update public.message_templates m
  set approval_status = 'draft'
  where m.company_id = p_company_id
    and m.meta_template_name is not null
    and m.approval_status in ('approved', 'submitted')
    and not exists (select 1 from public.whatsapp_message_templates w
                    where w.company_id = p_company_id and w.name = m.meta_template_name and w.language = m.language);

  select count(*) into v_count from pg_temp.synced_templates;
  return v_count;
end;
$$;
comment on function public.sync_whatsapp_message_templates(uuid, text, jsonb) is
  'Service role (worker): replaces an account''s synced Meta templates (with their text and header format) and reflects their status onto the company''s message_templates (private.whatsapp_template_approval: APPROVED and FLAGGED approved, PENDING and IN_APPEAL submitted, else rejected).';

-- --------------------------------------------------------------------------- message_templates: Meta's languages

-- A template is mapped from Meta, whose language codes include en_US, en_GB, zu, xh and others.
alter table public.message_templates drop constraint message_templates_language_check;
alter table public.message_templates
  add constraint message_templates_language_check check (length(language) between 1 and 20);

-- --------------------------------------------------------------------------- content rules

-- The first content problem of a template body for an audience, in words, or null. Mirrors checkOutboundMessage of
-- @leaseguard/domain for banking wording and the forbidden tenant topics (the API checks the full rules first).
create function private.template_content_problem(p_body text, p_audience public.recipient_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_body ~* '\maccount\s*(number|no\.?|nr\.?|#)'
      or p_body ~* '\macc(ount)?\.?\s*(no|nr)\M'
      or p_body ~* '\mbranch\s*code\M'
      or p_body ~* '\mbank(ing)?\s*details\M'
      or p_body ~* '\mswift\s*(code|bic)\M'
      or p_body ~* '\miban\M'
      or p_body ~ '\mEFT\M'
      or p_body ~* '\mpay(ments?)?\s+into\M'
      or p_body ~ '(^|[\s:])[0-9]{11,}($|[\s.,;])'
      then 'Messages may not contain banking details (LeaseGuard never collects payments)'
    when p_audience <> 'tenant' then null
    when p_body ~* '\mescalat(e|es|ed|ion|ions)\M' or p_body ~* '\mrent(al)?\s+increase'
      then 'Tenant messages may not mention rental escalation'
    when p_body ~* '\mlease\s+(expiry|expires|expiring|expiration|end|ends|ending)\M' or p_body ~* '\mexpiry\s+of\s+(your|the)\s+lease\M'
      then 'Tenant messages may not mention lease expiry'
    when p_body ~* '\mrenew(al|als|ed|ing)?\M'
      then 'Tenant messages may not mention renewal option'
    when p_body ~* '\mdisput(e|es|ed)\M'
      then 'Tenant messages may not mention dispute'
    when p_body ~* '\mguarantee(s|d)?\M'
      then 'Tenant messages may not mention bank guarantee'
    when p_body ~* '\mdeposits?\M'
      then 'Tenant messages may not mention deposit'
  end
$$;
revoke all on function private.template_content_problem(text, public.recipient_type) from public, anon, authenticated;

-- Every role (the service role included): these are product rules, not permissions.
create function private.guard_message_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  v_problem := private.template_content_problem(new.body, new.audience);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.message_type is distinct from old.message_type and exists (
    select 1 from public.message_type_templates mt where mt.company_id = new.company_id and mt.message_template_id = new.id
  ) then
    raise exception 'This template sends % messages. Choose another template for that type before changing it.',
      private.message_type_label(old.message_type) using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- The message type in words, as the settings page names it.
create function private.message_type_label(p_type public.message_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'monthly_statement' then 'Monthly statement'
    when 'initial_payment_reminder' then 'Initial payment reminder'
    when 'overdue_payment_reminder' then 'Overdue payment reminder'
    when 'follow_up_payment_reminder' then 'Follow-up payment reminder'
    when 'arrangement_installment_reminder' then 'Arrangement instalment reminder'
    when 'owner_weekly_summary' then 'Owner weekly summary'
    when 'owner_query_response' then 'Owner query response'
    when 'inbound_reply' then 'Inbound reply'
    else 'Manual message'
  end
$$;
revoke all on function private.message_type_label(public.message_type) from public, anon, authenticated;
revoke all on function private.guard_message_template() from public, anon, authenticated;

-- --------------------------------------------------------------------------- the mapping

create table public.message_type_templates (
  company_id uuid not null references public.companies (id) on delete cascade,
  message_type public.message_type not null,
  message_template_id uuid not null,
  mapped_at timestamptz not null default now(),
  mapped_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_type_templates_pkey primary key (company_id, message_type),
  -- A template serves one message type.
  constraint message_type_templates_template_key unique (company_id, message_template_id),
  constraint message_type_templates_template_fk foreign key (company_id, message_template_id)
    references public.message_templates (company_id, id) on delete cascade,
  constraint message_type_templates_mapped_by_fk foreign key (company_id, mapped_by_user_id)
    references public.company_users (company_id, user_id) on delete set null (mapped_by_user_id),
  constraint message_type_templates_type_check check (message_type not in ('inbound_reply', 'manual'))
);
create index message_type_templates_mapped_by_idx on public.message_type_templates (company_id, mapped_by_user_id)
  where mapped_by_user_id is not null;
comment on table public.message_type_templates is
  'Which of the company''s message templates sends each templated message type (one per type). Members read; company '
  'admins choose through set_message_type_template.';

create trigger set_updated_at before update on public.message_type_templates
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.message_type_templates
  for each row execute function private.prevent_company_change();

alter table public.message_type_templates enable row level security;
revoke all on public.message_type_templates from anon, authenticated;
grant select, insert, update, delete on public.message_type_templates to service_role;
grant select on public.message_type_templates to authenticated;
create policy members_read on public.message_type_templates for select to authenticated
  using (company_id = any ((select private.member_company_ids())::uuid[]));

-- Every role: the mapping's type is its template's, and a signed-in caller is stamped as the one who mapped it.
create function private.guard_message_type_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.message_type;
begin
  if new.message_type is distinct from coalesce(old.message_type, new.message_type) then
    raise exception 'A mapping''s message type is fixed' using errcode = 'P0001';
  end if;
  select m.message_type into v_type from public.message_templates m
  where m.company_id = new.company_id and m.id = new.message_template_id;
  if v_type is distinct from new.message_type then
    raise exception 'The template is for % messages, not %', private.message_type_label(v_type), private.message_type_label(new.message_type)
      using errcode = 'P0001';
  end if;
  if (select auth.uid()) is not null then
    new.mapped_by_user_id := (select auth.uid());
    new.mapped_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.guard_message_type_template() from public, anon, authenticated;

create trigger guard_change before insert or update on public.message_type_templates
  for each row execute function private.guard_message_type_template();

create trigger guard_content before insert or update of body, audience, message_type on public.message_templates
  for each row execute function private.guard_message_template();

-- --------------------------------------------------------------------------- audit

create function private.audit_message_type_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before text;
  v_after text;
begin
  select format('%s (%s)', m.meta_template_name, m.language) into v_after
  from public.message_templates m where m.company_id = new.company_id and m.id = new.message_template_id;
  if tg_op = 'UPDATE' then
    select format('%s (%s)', m.meta_template_name, m.language) into v_before
    from public.message_templates m where m.company_id = old.company_id and m.id = old.message_template_id;
  end if;
  perform private.write_audit(
    new.company_id, 'update', 'message_template', new.message_template_id,
    case when v_before is not distinct from v_after
      then format('%s: WhatsApp template %s chosen again', private.message_type_label(new.message_type), v_after)
      else format('%s now sent with WhatsApp template %s', private.message_type_label(new.message_type), v_after)
    end,
    jsonb_build_array(
      private.field_change('messageType', new.message_type::text, new.message_type::text),
      private.field_change('template', v_before, v_after),
      private.field_change('templateId', case when tg_op = 'UPDATE' then old.message_template_id end, new.message_template_id)
    )
  );
  return null;
end;
$$;
revoke all on function private.audit_message_type_template() from public, anon, authenticated;

create trigger audit_change after insert or update on public.message_type_templates
  for each row execute function private.audit_message_type_template();

-- --------------------------------------------------------------------------- message_templates: no direct writes

drop policy writers_insert on public.message_templates;
drop policy writers_update on public.message_templates;
drop policy writers_delete on public.message_templates;
revoke insert, update, delete on public.message_templates from authenticated;

-- --------------------------------------------------------------------------- choosing a template

create function public.set_message_type_template(
  p_company_id uuid,
  p_message_type public.message_type,
  p_whatsapp_template_id uuid,
  p_variables text[] default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_template public.whatsapp_message_templates;
  v_audience public.recipient_type;
  v_category text;
  v_numbers integer[];
  v_count integer;
  v_problem text;
  v_other public.message_type;
  v_variables text[];
  v_id uuid;
begin
  if (select auth.uid()) is null
     or not (p_company_id = any ((select private.company_ids_with_role('{company_admin}'))::uuid[])) then
    raise exception 'Only company admins choose message templates' using errcode = '42501';
  end if;
  if p_message_type in ('inbound_reply', 'manual') then
    raise exception '% messages are not sent with a template', private.message_type_label(p_message_type) using errcode = '22023';
  end if;
  -- One mapping change of the company at a time, so two admins cannot give one template to two types.
  perform pg_advisory_xact_lock(hashtextextended('message_type_templates:' || p_company_id::text, 0));

  select * into v_template from public.whatsapp_message_templates w
  where w.company_id = p_company_id and w.id = p_whatsapp_template_id;
  if not found then
    raise exception 'The WhatsApp template is not in this workspace' using errcode = 'P0002';
  end if;

  v_audience := case when private.is_tenant_message_type(p_message_type) then 'tenant' else 'property_owner' end;
  v_category := upper(v_template.category);
  if private.whatsapp_template_approval(v_template.status) <> 'approved' then
    raise exception 'Meta has not approved "%" (%). Only approved templates can be chosen.', v_template.name, initcap(replace(v_template.status, '_', ' '))
      using errcode = 'P0001';
  end if;
  if v_category = 'AUTHENTICATION' then
    raise exception '"%" is an authentication template; LeaseGuard messages use Utility templates.', v_template.name using errcode = 'P0001';
  end if;
  if v_audience = 'tenant' and v_category <> 'UTILITY' then
    raise exception 'A tenant message needs a Utility template for statement and payment messages; "%" is %.', v_template.name, initcap(v_category)
      using errcode = 'P0001';
  end if;
  if v_category not in ('UTILITY', 'MARKETING') then
    raise exception '"%" has Meta category %; choose a Utility template.', v_template.name, initcap(v_category) using errcode = 'P0001';
  end if;
  if v_template.body is null then
    raise exception 'LeaseGuard does not have the text of "%" yet. Sync the templates again, then choose it.', v_template.name using errcode = 'P0001';
  end if;
  if v_template.body ~ '\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}' then
    raise exception '"%" uses named parameters; LeaseGuard fills numbered placeholders {{1}}, {{2}}… only.', v_template.name using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct n order by n), '{}') into v_numbers
  from (select (m[1])::integer as n from regexp_matches(v_template.body, '\{\{\s*([0-9]+)\s*\}\}', 'g') as m) p;
  v_count := coalesce(array_length(v_numbers, 1), 0);
  if v_numbers is distinct from array(select generate_series(1, v_count)) then
    raise exception 'Placeholders of "%" must be numbered {{1}}…{{n}} without gaps', v_template.name using errcode = 'P0001';
  end if;
  v_problem := private.template_content_problem(v_template.body, v_audience);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;

  select mt.message_type into v_other
  from public.message_type_templates mt
  join public.message_templates m on m.company_id = mt.company_id and m.id = mt.message_template_id
  where mt.company_id = p_company_id and mt.message_type <> p_message_type
    and m.meta_template_name = v_template.name and m.language = v_template.language;
  if found then
    raise exception '"%" (%) already sends % messages. A template sends one message type.', v_template.name, v_template.language,
      private.message_type_label(v_other) using errcode = 'P0001';
  end if;

  v_variables := case
    when p_variables is not null and coalesce(array_length(p_variables, 1), 0) = v_count then p_variables
    else array(select 'Variable ' || i from generate_series(1, v_count) i)
  end;

  insert into public.message_templates as m (
    company_id, name, message_type, audience, meta_template_name, language, category, body, variables, approval_status,
    supports_document_attachment
  )
  values (
    p_company_id, v_template.name, p_message_type, v_audience, v_template.name, v_template.language, lower(v_category),
    v_template.body, v_variables, private.whatsapp_template_approval(v_template.status), coalesce(v_template.header_format = 'DOCUMENT', false)
  )
  on conflict (company_id, meta_template_name, language) do update
  set message_type = excluded.message_type, audience = excluded.audience, name = excluded.name, category = excluded.category,
      body = excluded.body, variables = excluded.variables, approval_status = excluded.approval_status,
      supports_document_attachment = excluded.supports_document_attachment
  returning m.id into v_id;

  insert into public.message_type_templates as mt (company_id, message_type, message_template_id)
  values (p_company_id, p_message_type, v_id)
  on conflict (company_id, message_type) do update
  set message_template_id = excluded.message_template_id, mapped_at = now();
  return v_id;
end;
$$;
revoke all on function public.set_message_type_template(uuid, public.message_type, uuid, text[]) from public, anon;
grant execute on function public.set_message_type_template(uuid, public.message_type, uuid, text[]) to authenticated;
comment on function public.set_message_type_template(uuid, public.message_type, uuid, text[]) is
  'A company admin chooses synced Meta template p_whatsapp_template_id for message type p_message_type and returns the '
  'company''s message template id. Copies Meta''s text, language, category, status and document header into '
  'message_templates (p_variables names the placeholders). 42501 for anyone but a company admin; 22023 for an untemplated '
  'type; P0002 for a template of another company; P0001 (in words) when Meta has not approved it, it is an '
  'authentication template, a tenant type''s template is not Utility, LeaseGuard has no text for it, its placeholders are '
  'named or have gaps, its text has banking details or (tenant) a forbidden topic, or it already sends another type. '
  'Audited on the template.';
