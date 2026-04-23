# {{NAME}} — Cloudflare subscription receiver

A [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
instance triggered by a Secondlayer subscription via Cloudflare's
`workflows/instances` REST API. "Workflows" here refers to Cloudflare's
durable-execution product; it's separate from anything Secondlayer runs.

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

Cloudflare authenticates the API call with the bearer token. Inside the
Workflows entrypoint, `event.payload.params._outboxId` is a stable dedup
key if you want idempotent replay handling.

## Deploy

```bash
npx wrangler deploy
```
