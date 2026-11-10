-- Statements, statement line items and statement extractions.
--
-- Extracted fields are a child table (statement_extraction_fields) rather than jsonb: each field is
-- reviewed and corrected individually, corrections must be attributed and audited per field,
-- the field name is constrained by the extraction_field_name enum with one row per field, and
-- reports count flagged fields across extractions.

create table public.statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  property_id uuid not null,
  -- Set once matched (automatically or manually).
  tenant_id uuid,
  unit_id uuid,
  lease_id uuid,
  file_name text not null,
  storage_path text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes bigint not null check (size_bytes > 0),
  -- SHA-256 of the uploaded file, used for duplicate detection.
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  source_system public.statement_source not null,
  statement_number text,
  statement_date date not null,
  period_start date not null,
  period_end date not null,
  status public.statement_status not null default 'uploaded',
  upload_batch_id text,
  uploaded_by_user_id uuid not null,
  uploaded_at timestamptz not null default now(),
  -- Verified figures. NULL until the extraction is confirmed: values are never guessed.
  opening_balance numeric(14, 2),
  rental_charged numeric(14, 2) check (rental_charged >= 0),
  additional_charges numeric(14, 2) check (additional_charges >= 0),
  payments_received numeric(14, 2) check (payments_received >= 0),
  -- Closing balance = outstanding balance owed by the tenant (negative when in credit).
  closing_balance numeric(14, 2),
  total_due numeric(14, 2),
  verified_by_user_id uuid,
  verified_at timestamptz,
  -- Set when the statement was delivered to the tenant (FK added with communications).
  delivered_communication_id uuid,
  duplicate_of_statement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint statements_company_id_key unique (company_id, id),
  constraint statements_period_check check (period_end >= period_start),
  constraint statements_storage_path_check check (storage_path like company_id::text || '/%'),
  constraint statements_property_fk foreign key (company_id, property_id)
    references public.properties (company_id, id),
  constraint statements_unit_fk foreign key (company_id, property_id, unit_id)
    references public.units (company_id, property_id, id),
  constraint statements_tenant_fk foreign key (company_id, tenant_id)
    references public.tenants (company_id, id),
  constraint statements_lease_fk foreign key (company_id, lease_id)
    references public.leases (company_id, id),
  constraint statements_uploaded_by_fk foreign key (company_id, uploaded_by_user_id)
    references public.company_users (company_id, user_id),
  constraint statements_verified_by_fk foreign key (company_id, verified_by_user_id)
    references public.company_users (company_id, user_id),
  constraint statements_duplicate_of_fk foreign key (company_id, duplicate_of_statement_id)
    references public.statements (company_id, id),
  -- A verified statement carries every reconciled figure and who verified it; any other status
  -- carries none, so unconfirmed numbers can never be read as evidence.
  constraint statements_verified_figures_check check (
    case when status = 'verified' then
      opening_balance is not null and rental_charged is not null and additional_charges is not null
      and payments_received is not null and closing_balance is not null and total_due is not null
      and verified_by_user_id is not null and verified_at is not null
    else
      opening_balance is null and rental_charged is null and additional_charges is null
      and payments_received is null and closing_balance is null and total_due is null
    end
  ),
  constraint statements_duplicate_check check ((status = 'duplicate') = (duplicate_of_statement_id is not null))
);
-- Duplicate detection: one live statement per file hash per company. Rows already marked as
-- duplicates or rejected keep their hash for traceability.
create unique index statements_company_sha256_live_idx on public.statements (company_id, file_sha256)
  where status not in ('duplicate', 'rejected');
create index statements_company_sha256_idx on public.statements (company_id, file_sha256);
create index statements_company_status_idx on public.statements (company_id, status);
create index statements_company_date_idx on public.statements (company_id, statement_date);
create index statements_property_idx on public.statements (company_id, property_id);
create index statements_unit_idx on public.statements (company_id, property_id, unit_id) where unit_id is not null;
create index statements_tenant_idx on public.statements (company_id, tenant_id, statement_date) where tenant_id is not null;
create index statements_lease_idx on public.statements (company_id, lease_id) where lease_id is not null;
create index statements_uploaded_by_idx on public.statements (company_id, uploaded_by_user_id);
create index statements_verified_by_idx on public.statements (company_id, verified_by_user_id) where verified_by_user_id is not null;
create index statements_duplicate_of_idx on public.statements (company_id, duplicate_of_statement_id) where duplicate_of_statement_id is not null;
create index statements_batch_idx on public.statements (company_id, upload_batch_id) where upload_batch_id is not null;

create table public.statement_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  statement_id uuid not null,
  -- Order of the line on the printed statement.
  line_number smallint not null check (line_number > 0),
  date date not null,
  description text not null,
  category public.line_item_category not null,
  kind public.line_item_kind not null,
  -- Always positive; `kind` gives the direction.
  amount numeric(14, 2) not null check (amount >= 0),
  -- Extraction confidence for this line was below threshold.
  flagged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint statement_line_items_statement_line_key unique (statement_id, line_number),
  constraint statement_line_items_kind_check check (
    (category = 'payment') = (kind = 'payment') and (category = 'credit') = (kind = 'credit')
  ),
  constraint statement_line_items_statement_fk foreign key (company_id, statement_id)
    references public.statements (company_id, id) on delete cascade
);
create index statement_line_items_statement_idx on public.statement_line_items (company_id, statement_id);

create table public.statement_extractions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  statement_id uuid not null unique,
  engine text not null,
  extracted_at timestamptz not null default now(),
  overall_confidence numeric(4, 3) not null check (overall_confidence between 0 and 1),
  -- Tenant/unit match proposed by the extractor.
  matched_tenant_id uuid,
  matched_unit_id uuid,
  match_confidence numeric(4, 3) not null check (match_confidence between 0 and 1),
  status public.extraction_status not null default 'pending_review',
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint statement_extractions_company_id_key unique (company_id, id),
  constraint statement_extractions_statement_fk foreign key (company_id, statement_id)
    references public.statements (company_id, id) on delete cascade,
  constraint statement_extractions_matched_tenant_fk foreign key (company_id, matched_tenant_id)
    references public.tenants (company_id, id),
  constraint statement_extractions_matched_unit_fk foreign key (company_id, matched_unit_id)
    references public.units (company_id, id),
  constraint statement_extractions_reviewed_by_fk foreign key (company_id, reviewed_by_user_id)
    references public.company_users (company_id, user_id),
  constraint statement_extractions_review_check check (
    status = 'pending_review' or (reviewed_by_user_id is not null and reviewed_at is not null)
  )
);
create index statement_extractions_company_status_idx on public.statement_extractions (company_id, status);
create index statement_extractions_matched_tenant_idx on public.statement_extractions (company_id, matched_tenant_id) where matched_tenant_id is not null;
create index statement_extractions_matched_unit_idx on public.statement_extractions (company_id, matched_unit_id) where matched_unit_id is not null;
create index statement_extractions_reviewed_by_idx on public.statement_extractions (company_id, reviewed_by_user_id) where reviewed_by_user_id is not null;

-- value / corrected_value hold a JSON string, number or null, matching ExtractedField.value.
create table public.statement_extraction_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  extraction_id uuid not null,
  name public.extraction_field_name not null,
  raw_text text not null,
  value jsonb not null check (jsonb_typeof(value) in ('string', 'number', 'null')),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  flagged boolean not null default false,
  corrected_value jsonb check (jsonb_typeof(corrected_value) in ('string', 'number')),
  corrected_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint statement_extraction_fields_extraction_name_key unique (extraction_id, name),
  -- A field the extractor could not read is flagged for review, never silently filled in.
  constraint statement_extraction_fields_missing_flagged_check check (value <> 'null'::jsonb or flagged),
  constraint statement_extraction_fields_correction_check check (
    (corrected_value is null) = (corrected_by_user_id is null)
  ),
  constraint statement_extraction_fields_extraction_fk foreign key (company_id, extraction_id)
    references public.statement_extractions (company_id, id) on delete cascade,
  constraint statement_extraction_fields_corrected_by_fk foreign key (company_id, corrected_by_user_id)
    references public.company_users (company_id, user_id)
);
create index statement_extraction_fields_extraction_idx on public.statement_extraction_fields (company_id, extraction_id);
create index statement_extraction_fields_flagged_idx on public.statement_extraction_fields (company_id) where flagged;
create index statement_extraction_fields_corrected_by_idx on public.statement_extraction_fields (company_id, corrected_by_user_id) where corrected_by_user_id is not null;

create trigger set_updated_at before update on public.statements
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.statements
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.statement_line_items
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.statement_line_items
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.statement_extractions
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.statement_extractions
  for each row execute function private.prevent_company_change();
create trigger set_updated_at before update on public.statement_extraction_fields
  for each row execute function private.set_updated_at();
create trigger prevent_company_change before update on public.statement_extraction_fields
  for each row execute function private.prevent_company_change();
