-- A company_admin edits only their company's profile and monitoring settings.
--
-- authenticated held UPDATE on every column of companies, so an admin could call the Data API
-- directly to reactivate a suspended company (the worker processes companies by status), rewrite
-- initials, or switch off require_approval_for_tenant_messages and with it the database-level
-- enforcement of tenant-message approval. Platform-managed columns (status, initials,
-- require_approval_for_tenant_messages, timezone, country, id, timestamps) are now service-role only.
-- The admins_update policy still limits which rows can be updated; set_updated_at writes updated_at
-- from a trigger, which needs no column grant.

revoke update on public.companies from authenticated;
grant update (
  name, trading_name, registration_number, vat_number,
  address_line1, address_line2, suburb, city, province, postal_code,
  contact_email, contact_phone,
  lease_expiry_notice_days, renewal_deadline_warning_days, guarantee_expiry_notice_days,
  payment_reminder_initial_days, payment_reminder_overdue_days, payment_reminder_follow_up_days,
  installment_reminder_lead_days, owner_summary_weekday
) on public.companies to authenticated;
