# {{NAME}} — Trigger.dev subscription receiver

A Trigger.dev v3 task that receives subgraph events via the
`{task}/trigger` HTTP API.

## Run

```bash
bun install
bunx trigger.dev@latest init     # follow prompts
bun run dev
```

The Trigger CLI provisions a project and shows the task endpoint URL. Your
Secondlayer subscription URL should point at:

```
https://api.trigger.dev/api/v1/tasks/{{TASK_ID}}/trigger
```

Provision the subscription with bearer auth:

```bash
sl create subscription {{NAME}} --runtime trigger --auth-token tr_secret_abc...
```

You can also patch an existing subscription with
`sl subscriptions update {{NAME}} --auth-token tr_secret_abc...`.

## Signature verification

Trigger authenticates requests with the bearer token — there's no separate
HMAC. Your secret IS the auth. Rotate via the Trigger dashboard when
needed.

## Deploy

Run `bunx trigger.dev@latest deploy` to push to Trigger Cloud.
