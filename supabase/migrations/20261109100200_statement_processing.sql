-- Columns the statement-processing worker needs to leave every statement in a reviewable state.
--
-- statements.processing_error: why automatic extraction could not produce a proposal (the
--   document-processing service rejected the PDF, the response broke the contract, the file was
--   missing or too large, or retries were exhausted). The statement is then `review_required` and a
--   person enters or checks the figures; nothing is guessed. Cleared when a later run succeeds.
-- statement_extractions.issues: the extraction issues reported by the service
--   (DocumentExtractionIssue[] from @leaseguard/domain: { code, severity, message, field }), shown to
--   the reviewer next to the flagged fields.
--
-- Additive: both columns are nullable or defaulted; existing rows are unchanged.

alter table public.statements
  add column processing_error text check (processing_error is null or length(trim(processing_error)) > 0);

alter table public.statement_extractions
  add column issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array');

comment on column public.statements.processing_error is
  'Why automatic extraction failed; the statement stays review_required for manual entry.';
comment on column public.statement_extractions.issues is
  'DocumentExtractionIssue[] reported by the document-processing service.';
