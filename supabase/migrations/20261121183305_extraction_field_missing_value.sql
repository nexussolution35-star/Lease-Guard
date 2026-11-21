-- A field the document did not show is stored with value JSON null ('null'::jsonb), never SQL NULL.
--
-- 20261109100300 gave statement_extraction_fields.value a 'null'::jsonb default so the statement-processing worker
-- could omit `value` for a field it did not find. That only works when `value` is left out of the insert's column
-- list. The worker stores all fields of an extraction in one bulk upsert, and supabase-js then names the union of
-- every row's keys in `columns`, so `value` is always in the column list; PostgREST (verified on 16.5) fills a row's
-- missing key with SQL NULL even with `Prefer: missing=default`, and the NOT NULL column rejects the whole batch. Every
-- statement with a value that was not found failed processing. Found by the statements acceptance test (ticket S-09).
--
-- A BEFORE INSERT trigger turns a NULL value into JSON null, whatever the client sends. The existing checks still
-- require such a field to be flagged (statement_extraction_fields_missing_flagged_check) and refuse to confirm it.
--
-- Additive: one trigger function and one trigger; existing rows are unchanged.

create function private.default_extraction_field_value()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.value := coalesce(new.value, 'null'::jsonb);
  return new;
end;
$$;

revoke all on function private.default_extraction_field_value() from public;

create trigger default_missing_value
  before insert on public.statement_extraction_fields
  for each row when (new.value is null)
  execute function private.default_extraction_field_value();
