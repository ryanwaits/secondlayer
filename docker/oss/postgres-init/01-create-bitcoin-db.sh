#!/bin/sh
# Provisions the separate `bitcoin` database (D18, plan 062) that
# packages/bitcoin's own Postgres schema lives in — kept apart from the main
# `${POSTGRES_DB:-secondlayer}` database, same split as the source repo keeps
# for Stacks vs Bitcoin/Runes. Created unconditionally (not gated on the
# `bitcoin` compose profile), so `secondlayer`'s BITCOIN_DATABASE_URL always
# points at something real: when the `runes` service (the one that runs
# `migrate`) isn't running yet, the database exists but is empty, and
# packages/api/src/bitcoin/db.ts's readers degrade to their not-configured
# notes on the missing tables instead of erroring.
#
# Postgres's docker-entrypoint.sh only runs docker-entrypoint-initdb.d/ on the
# very first init of an empty data volume — this never re-runs against an
# already-provisioned one — but the existence check below keeps it safe to
# invoke by hand too.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
	SELECT 'CREATE DATABASE bitcoin'
	WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bitcoin')\gexec
EOSQL
