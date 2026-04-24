# Subscriptions

Subscriptions deliver inserted subgraph table rows to HTTP receivers.

Create the subgraph first. Then create a subscription for one table.

## Create

CLI receiver scaffolder:

```bash
sl create subscription whale-alerts --runtime node
sl create subscription whale-alerts --runtime inngest
sl create subscription whale-alerts --runtime trigger
sl create subscription whale-alerts --runtime cloudflare
```

Useful flags:

```bash
--subgraph <name>
--table <name>
--url <https://...>
--filter amount.gte=1000000
--service-key <key>
--base-url <url>
--skip-api
```

SDK:

```typescript
const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "whale-alerts",
  subgraphName: "token-transfers",
  tableName: "transfers",
  url: "https://example.com/webhooks/sl",
  runtime: "node",
  format: "standard-webhooks",
  filter: { amount: { gte: "100000000" } },
});
```

`signingSecret` is returned once. Store it server-side. The platform does not
show it again.

## Formats And Runtimes

Formats:

- `standard-webhooks` — default signed HTTP POST.
- `inngest` — Inngest events API body.
- `trigger` — Trigger.dev task trigger body.
- `cloudflare` — Cloudflare Workflows body.
- `cloudevents` — CloudEvents 1.0 structured JSON.
- `raw` — raw row payload plus user auth headers.

Runtime labels:

- `node`
- `inngest`
- `trigger`
- `cloudflare`

Runtime is a display/scaffold hint. Format controls the delivered wire shape.

## Standard Webhooks Test Fixture

The safe test path is generate-only. Do not POST from an agent unless the user
explicitly runs the CLI with `--post`.

```bash
sl subscriptions test whale-alerts --signing-secret "$SIGNING_SECRET"
```

The command emits:

- JSON body `{ type, timestamp, data }`;
- `content-type`, `webhook-id`, `webhook-timestamp`, `webhook-signature`;
- copyable `curl`.

Agents must use only a user-provided signing secret. Never request or recover a
stored platform secret.

## Filters

Filters are scalar row filters evaluated before delivery.

```json
{
  "amount": { "gte": "100000000" },
  "sender": "SP...",
  "kind": { "in": ["mint", "burn"] }
}
```

Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`. Bare values are
`eq`.

Only scalar columns can be filtered: `text`, `uint`, `int`, `principal`,
`boolean`, `timestamp`.

## Lifecycle

```bash
sl subscriptions list --json
sl subscriptions get whale-alerts --json
sl subscriptions update whale-alerts --url https://example.com/hooks/sl
sl subscriptions pause whale-alerts
sl subscriptions resume whale-alerts
sl subscriptions rotate-secret whale-alerts
sl subscriptions delete whale-alerts
```

Human-confirm `rotate-secret` and `delete`.

## Delivery Inspection

```bash
sl subscriptions deliveries whale-alerts
sl subscriptions doctor whale-alerts
```

Doctor inspects:

- subscription status and circuit state;
- recent delivery attempts;
- dead-letter queue count;
- linked subgraph status, gaps, and sync state;
- next-step hints.

## Replay And DLQ

```bash
sl subscriptions dead whale-alerts
sl subscriptions requeue whale-alerts <outbox-id>
sl subscriptions replay whale-alerts --from-block 180000 --to-block 181000
```

Requeue only selected dead-letter rows after fixing the receiver.

Replay re-enqueues historical matching rows. Confirm exact block ranges with
the user. Replays drain at reduced capacity so live delivery stays responsive.
