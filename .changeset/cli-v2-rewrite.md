---
"@secondlayer/cli": major
"@secondlayer/shared": minor
---

CLI v2 — session-based auth, tenant auto-resolve, full instance lifecycle.

**Breaking changes (`@secondlayer/cli`)**:

- `sl auth login/logout/status` replaced by top-level `sl login` / `sl logout`. `sl auth` command group removed entirely.
- `sl auth keys list/create/revoke/rotate` removed. Session tokens are the only CLI credential; machine access uses `SL_SERVICE_KEY`.
- `sl instance connect <url> --key` removed. Tenant URL + service key are auto-resolved per command from the session.
- `sl sync` removed (superseded by `sl local`).
- `~/.secondlayer/config.json` no longer holds `apiUrl` / `apiKey`. Sessions at `~/.secondlayer/session.json`.
- `SECONDLAYER_API_KEY` env var no longer read.

**New (`@secondlayer/cli`)**:

- `sl login` — magic-link email with 6-digit code. Session cached 90d with server-side sliding-window renewal.
- `sl logout` — revokes session server-side + clears local file.
- `sl whoami` — shows email, plan, active project, instance URL + trial days.
- `sl project create <name> | list | use <slug> | current` — project management, per-directory binding at `./.secondlayer/project`.
- `sl instance create --plan <…> | info | resize | suspend | resume | delete | keys rotate` — full tenant lifecycle.
- Resolver auto-mints 5-min ephemeral service JWTs per command. No long-lived service key on disk.
- `SL_SERVICE_KEY` + `SL_API_URL` env-var bypass for CI/OSS. `sl instance *` refuses in OSS mode with a clear error.

**`@secondlayer/shared`**:

- New error codes + classes: `KeyRotatedError` (401), `TrialExpiredError` (402), `TenantSuspendedError` (423). `NO_TENANT_FOR_PROJECT` (404) and `INSTANCE_EXISTS` (409) added to `CODE_TO_STATUS`.
- Tenant API `auth-modes.dedicatedAuth` throws `KeyRotatedError` on gen mismatch so the CLI can retry-once transparently.
