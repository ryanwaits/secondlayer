# Smoke Tests

## When Required

Add a smoke test for every continuous service.

Add a smoke test for every new endpoint unless a contract test fully covers it. If N/A, write the reason in `.agents/current-sprint.md`.

## Location

Smoke tests live in `tests/smoke/`.

## Harness

The reusable continuous-service harness is `tests/smoke/continuous-service.ts`.

Current coverage: `tests/smoke/l2-decoder.smoke.test.ts`.

The harness creates an isolated Postgres database, runs migrations, starts the service, waits at least 60 seconds, checks progress, stops the service, and drops the database.

## Local Run

Start local Postgres, then run:

```sh
bun run test:smoke
```

Default database URL:

```sh
postgresql://postgres:postgres@127.0.0.1:5435/secondlayer
```

Override with `DATABASE_URL`.

## CI

The deploy workflow runs `scripts/ci/post-deploy-smoke.sh` after deploy.

It checks `/v1/streams/events`, `/v1/index/ft-transfers`, and `/v1/streams/tip` with auth variants.
