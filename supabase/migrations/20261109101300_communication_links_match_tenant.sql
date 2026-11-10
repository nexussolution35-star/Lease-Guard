-- A tenant message may only reference that tenant's lease, statement and arrangement, and an outbound
-- tenant attachment must be the referenced statement's own file.
--
-- The links from communications were composite only on (company_id, x_id), and the attachment path
-- only had to start with the company id. A message to tenant A could therefore carry tenant B's
-- statement and B's statement PDF, which the delivery worker downloads and sends as-is; the human
-- approval would have been the only thing in the way of sending one tenant's financial statement to
-- another.
--
-- MATCH SIMPLE skips the three-column foreign keys for owner messages (tenant_id is NULL). The
-- attachment rule applies to outbound tenant messages only: inbound replies may carry their own media
-- and leave statement_id empty. The existing two-column foreign keys stay. The existing partial
-- (company_id, x_id) indexes on communications already lead with the new keys' columns.
-- Note for PostgREST embeds: communications now has two relationships each to statements, leases and
-- payment_arrangements, so an embed between them must name the foreign key (`!fk_name`).

alter table public.statements
  add constraint statements_company_id_tenant_key unique (company_id, id, tenant_id),
  add constraint statements_company_id_storage_path_key unique (company_id, id, storage_path);
alter table public.payment_arrangements
  add constraint payment_arrangements_company_id_tenant_key unique (company_id, id, tenant_id);
alter table public.leases
  add constraint leases_company_id_tenant_key unique (company_id, id, tenant_id);

alter table public.communications
  add constraint communications_statement_tenant_fk foreign key (company_id, statement_id, tenant_id)
    references public.statements (company_id, id, tenant_id),
  add constraint communications_arrangement_tenant_fk foreign key (company_id, arrangement_id, tenant_id)
    references public.payment_arrangements (company_id, id, tenant_id),
  add constraint communications_lease_tenant_fk foreign key (company_id, lease_id, tenant_id)
    references public.leases (company_id, id, tenant_id),
  add constraint communications_statement_attachment_fk foreign key (company_id, statement_id, attachment_storage_path)
    references public.statements (company_id, id, storage_path),
  add constraint communications_tenant_attachment_check check (
    direction <> 'outbound' or recipient_type <> 'tenant' or attachment_storage_path is null or statement_id is not null
  );
