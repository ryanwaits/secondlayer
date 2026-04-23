# {{NAME}} — Cloudflare Workflows subscription receiver

A Cloudflare Workflow triggered by a Secondlayer subscription via the
`workflows/instances` REST API.

## Run

```bash
bun install
npx wrangler login
npx wrangler dev
```

`wrangler dev` spins up a local runtime. Your subscription URL should
point at Cloudflare's API:

```
https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/workflows/{{NAME}}/instances
```

With `auth_config`:

```json
{ "authType": "bearer", "token": "<CF_API_TOKEN>" }
```

The token must have `Workflows: Edit` scope.

## Signature verification

Cloudflare authenticates the API call with the bearer token. Inside your
workflow the `event.payload.params._outboxId` is a stable dedup key if
you want idempotent replay handling.

## Deploy

```bash
npx wrangler deploy
```
