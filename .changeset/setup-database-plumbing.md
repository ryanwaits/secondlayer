---
"@secondlayer/cli": major
---

`secondlayer start` is removed. It needed a `DATABASE_URL` that `init` never wrote and printed a compose path that only exists inside a repo checkout; `secondlayer setup` brings the stack up, and a checkout runs `docker compose -f docker/oss/docker-compose.yml --env-file .env.local up -d` directly.

`setup` now writes `DATABASE_URL` into `.env` (the compose Postgres it just started, on the host port it actually bound) and passes it, with `ARCHIVE_SIGNING_PUBLIC_KEY`, `SL_API_URL`, and `INSTANCE_TOKEN`, to the `bootstrap` and `verify` it shells out to; before, those inherited the shell and restored into the shared dev database. A `SELECT 1` runs before bootstrap so a Postgres that is not up fails in one line, before any archive quote. An operator-edited `DATABASE_URL` survives re-runs; one setup generated itself is rebuilt from the port the re-run binds, so a remapped Postgres port never leaves bootstrap pointed at the old one. `--dir` defaults to `.`.

`init` reads the global `--api-url` instead of a local copy that Commander silently ignored; `subgraphs scaffold` drops its shadowed, unused `--api-key`. The network vocabulary is `mainnet|testnet|devnet` everywhere (`--help`, README, skill); an unknown `--network` exits 1 with one line, and `STACKS_NETWORK` values the config layer cannot map are named on stderr instead of dropped.

`uninstall` finds the stack `setup` wrote: `./docker-compose.yml` with `--env-file ./.env`, falling back to the repo compose file; the keys guard now sees `.env` as well as `.env.local`, and any existing env file counts as keys present even without `SECONDLAYER_SECRETS_KEY`, so `--purge --yes` in a setup directory still refuses without `--backup`. The dry run names the compose, env, and keys files it found.
