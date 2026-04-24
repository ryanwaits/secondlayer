# Troubleshooting

## Subgraph Behind Or Stalled

Inspect first:

```bash
sl subgraphs status my-subgraph
sl subgraphs list --json
```

Check:

- status;
- last processed block versus chain tip;
- error count and last error;
- table row counts;
- gaps or integrity warnings if present.

If code changed schema columns or sources, deploy with `--reindex` only after
the user confirms table data will be dropped and repopulated.

## Handler Runtime Error

1. Read the current source.
2. Identify the source key and handler key involved.
3. Check payload shape: print events use `event.data`, transfers use top-level
   fields.
4. Patch the source.
5. Deploy and verify status.

## No Subscription Deliveries

Inspect:

```bash
sl subscriptions get my-subscription
sl subscriptions deliveries my-subscription
sl subscriptions doctor my-subscription
sl subgraphs status <linked-subgraph>
```

Likely causes:

- no rows inserted into the source table;
- filter excludes all rows;
- linked subgraph is still catching up;
- receiver URL is wrong;
- subscription is paused.

## Receiver 4xx/5xx Or Timeout

1. Inspect recent deliveries.
2. Generate a signed test fixture with the user's signing secret.
3. Ask the user to run the `curl` against their receiver or inspect receiver
   logs.
4. Resume only after the receiver is healthy.

```bash
sl subscriptions test my-subscription --signing-secret "$SIGNING_SECRET"
```

## Paused Or Circuit-Open Subscription

```bash
sl subscriptions doctor my-subscription
sl subscriptions deliveries my-subscription
sl subscriptions resume my-subscription
```

Resume resets circuit failures and drains the backlog. Confirm the receiver is
healthy first.

## Dead-Letter Rows

```bash
sl subscriptions dead my-subscription
sl subscriptions requeue my-subscription <outbox-id>
```

Requeue only selected rows. Do not bulk requeue until the receiver has been
fixed and a signed test fixture succeeds.

## Replay

```bash
sl subscriptions replay my-subscription --from-block 180000 --to-block 181000
```

Replay only after:

- the exact block range is known;
- linked subgraph state is healthy enough;
- the receiver can handle replayed rows;
- the user confirms the range.
