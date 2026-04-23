# {{NAME}} — Inngest subscription receiver

Inngest Dev Server with a function wired to `{{EVENT_NAME}}`. Events come
from your Secondlayer subscription — Inngest handles retries, concurrency,
and step-level state.

## Run

```bash
bun install
bun run dev
```

This starts the Inngest dev UI at `http://localhost:8288`. Point your
subscription URL at the Inngest event endpoint shown in the dev UI
(typically `http://localhost:8288/e/{eventKey}` for local, or the hosted
`https://inn.gs/e/{eventKey}` endpoint for cloud).

## Signature verification

Inngest uses its own event key auth — there's no HMAC to verify. The event
key in the URL IS the auth token. For self-hosted Inngest add an ingress
allowlist so only the Secondlayer emitter can post.

## Deploy

- **Inngest Cloud**: create an app at https://inngest.com, copy the event
  key, and set it in the subscription URL: `https://inn.gs/e/{EVENT_KEY}`.
- **Self-host**: see https://www.inngest.com/docs/self-hosting
