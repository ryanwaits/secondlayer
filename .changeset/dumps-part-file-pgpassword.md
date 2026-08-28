---
"@secondlayer/cli": minor
---

`streams dumps` refuses a manifest path that is absolute, carries `..`, or resolves outside `--to`, streams each file into `<name>.part` while hashing, and renames into place only once the sha256 matches, so an interrupted download leaves a `.part` and never a truncated file under the final name. `backup` and `restore` move the database password out of `pg_dump`/`pg_restore` argv into `PGPASSWORD`, so it no longer shows in `ps`, and drain the child's stdout so a chatty dump cannot deadlock. `subscriptions create` writes `.env` owner-only (0600) on every branch, including when it is seeded from `.env.example`. Help for `--api-key`, `--auth-token`, `--signing-secret`, and `--passphrase` names the env form as the one to prefer, since a flag lands in shell history and `ps`.
