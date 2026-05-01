-- Initialize database
-- This file is executed when the PostgreSQL container first starts.
--
-- The main `secondlayer` database is created via POSTGRES_DB env var with
-- owner `postgres`. Some test files (and the api/.env default) connect as
-- a `secondlayer` role instead — create it here so either path works
-- without manual setup.

CREATE ROLE secondlayer WITH LOGIN SUPERUSER PASSWORD 'secondlayer';
