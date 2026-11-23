-- Restore normal Data API schema visibility after the private OAuth migration.
-- This does NOT grant access to the OAuth tables: their table-level privileges
-- remain revoked from anon/authenticated and granted only to service_role.
grant usage on schema public to anon, authenticated, service_role;
