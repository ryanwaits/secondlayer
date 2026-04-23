# {{NAME}} — Node.js subscription receiver

Hono HTTP server that verifies Standard Webhooks signatures and routes events
to your business logic. No framework lock-in.

## Run

```bash
bun install
cp .env.example .env   # paste the signingSecret you copied on create
bun run dev
```

The server listens on `:3000`. Your subscription's URL should point at
`http://<host>:3000/webhook`.

## Signature verification

Every request is verified before your handler runs. Forged requests return
`401`. The logic lives in `src/index.ts`; swap `@secondlayer/shared` for the
[Svix verify library](https://docs.standardwebhooks.com/libraries) if you
want to decouple from `@secondlayer/shared`:

```ts
import { Webhook } from "standardwebhooks";
const wh = new Webhook(process.env.SIGNING_SECRET!);
const event = wh.verify(body, headers);
```

## Deploy

Fly.io, Render, Railway, your own VM — anywhere that can run `bun` works.
Expose port 3000, set `SIGNING_SECRET`, point the subscription URL at the
public hostname.
