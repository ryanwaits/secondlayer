-- Initialize database
-- Runs once when the postgres container first creates its data directory.
-- THIS FILE IS DEV-ONLY: mounted by `docker/docker-compose.dev.yml` and not
-- by the Hetzner production compose. Production deploys use real secrets
-- supplied via env, never this script.
--
-- The main `secondlayer` database is created via POSTGRES_DB env. Some
-- test files (and api/.env) connect as a `secondlayer` role rather than
-- `postgres` — create it here so either path works without manual setup.
--
-- Notes:
--   * Role does NOT get SUPERUSER. App-level usage needs CREATEDB at most
--     (per-tenant DB creation in the provisioner happens via a different
--     bootstrap on production, not this file).
--   * Password is a literal because the postgres entrypoint doesn't
--     forward arbitrary env vars to psql. The dev port is bound to
--     127.0.0.1 only (`docker-compose.dev.yml`) so this role is
--     unreachable from anywhere outside the developer's loopback.
--   * If you ever bind dev pg to 0.0.0.0, change this password first.

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'secondlayer') THEN
		CREATE ROLE secondlayer WITH LOGIN CREATEDB PASSWORD 'secondlayer';
	END IF;
END$$;

GRANT ALL PRIVILEGES ON DATABASE secondlayer TO secondlayer;
