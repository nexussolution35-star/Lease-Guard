-- statement_extraction_fields.value holds a JSON string, number or JSON null ('null'::jsonb, "not
-- found"). Through the Data API a JSON null in a request body becomes SQL NULL, which the NOT NULL
-- column rejects, so the statement-processing worker could not store a field the extractor did not
-- find. With this default the worker omits `value` for such a field (PostgREST `missing=default`) and the
-- row gets JSON null. The existing check still requires such a field to be flagged for review.
--
-- Additive: only a column default; existing rows are unchanged.

alter table public.statement_extraction_fields alter column value set default 'null'::jsonb;
