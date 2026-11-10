-- A row that names a lease must name that lease's tenant, property and unit.
--
-- tenant_id, unit_id and lease_id on statements, monitoring events, payment arrangements and units
-- were each checked against the company on their own, never against each other. An arrangement could
-- name tenant A on tenant B's lease, and the arrears worker (which suppresses reminders by
-- payment_arrangements.tenant_id) would then silence the wrong tenant's reminders, breaking the rule
-- that an active arrangement suppresses arrears reminders for its own tenant.
--
-- Composite foreign keys onto (company_id, id, tenant_id, property_id, unit_id) of leases make the
-- columns agree for every role, including the service role and bulk loads. MATCH SIMPLE skips a
-- foreign key when any column is NULL, so a lease reference must also carry its tenant and unit.
--
-- Backend: statement registration fills tenant_id and unit_id from the lease when the body leaves them
-- out (statement-uploads.service.ts); without that, registering against a lease alone would now fail.
--
-- The older two-column lease foreign keys stay (redundant but harmless). No new referencing-side
-- indexes are needed: the existing (company_id, lease_id) indexes lead with the new keys' columns.

alter table public.leases
  add constraint leases_company_lease_parties_key unique (company_id, id, tenant_id, property_id, unit_id);

alter table public.payment_arrangements
  drop constraint payment_arrangements_lease_fk,
  add constraint payment_arrangements_lease_fk foreign key (company_id, lease_id, tenant_id, property_id, unit_id)
    references public.leases (company_id, id, tenant_id, property_id, unit_id);

alter table public.statements
  add constraint statements_lease_parties_check
    check (lease_id is null or (tenant_id is not null and unit_id is not null)),
  add constraint statements_lease_parties_fk foreign key (company_id, lease_id, tenant_id, property_id, unit_id)
    references public.leases (company_id, id, tenant_id, property_id, unit_id);

alter table public.monitoring_events
  add constraint monitoring_events_lease_parties_check
    check (lease_id is null or (tenant_id is not null and unit_id is not null)),
  add constraint monitoring_events_lease_parties_fk foreign key (company_id, lease_id, tenant_id, property_id, unit_id)
    references public.leases (company_id, id, tenant_id, property_id, unit_id);

-- units.current_lease_id / current_tenant_id: the unit is the lease's unit and the tenant is the
-- lease's tenant.
alter table public.units
  add constraint units_current_lease_parties_fk foreign key (company_id, current_lease_id, current_tenant_id, property_id, id)
    references public.leases (company_id, id, tenant_id, property_id, unit_id);
-- A unit is inserted before its lease exists, so current_tenant_id and current_lease_id are set
-- together in one update once the lease is in place.

-- ...and both are set or both are empty.
alter table public.units
  add constraint units_current_pair_check check ((current_lease_id is null) = (current_tenant_id is null));
