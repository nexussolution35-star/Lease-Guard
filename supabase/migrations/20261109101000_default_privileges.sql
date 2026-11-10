-- New objects grant nothing to the API roles by default.
--
-- The postgres role (which runs migrations) had default privileges in schema public that gave anon
-- and authenticated TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on every new table and UPDATE on every
-- new sequence. Today's tables are clean only because 20261107101000 revoked everything once; any
-- table added later would silently get TRUNCATE (which ignores RLS). Every migration must grant
-- exactly what it needs, as 20261107101000 does.
--
-- Functions are left as they are. Postgres grants EXECUTE to PUBLIC on every new function, and a
-- per-schema REVOKE cannot remove that global default (a per-schema `revoke execute on functions` in
-- private would be a no-op). A global revoke would also change every helper created by tests and
-- tooling. Instead each migration revokes PUBLIC on the private functions it creates, as before;
-- private is not exposed through the Data API and its usage is limited to authenticated and
-- service_role.
--
-- Idempotent: running it where the defaults are already narrower changes nothing.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
