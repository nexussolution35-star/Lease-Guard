-- Test messages are ordered by creation to find a company's latest attempt (onboarding step "test message").
-- now() is the transaction's start time, so two attempts created in one transaction tied and the tie fell to a random
-- uuid. clock_timestamp() gives each row its real creation time, so "latest" is always the attempt made last.
alter table public.whatsapp_test_messages alter column created_at set default clock_timestamp();
