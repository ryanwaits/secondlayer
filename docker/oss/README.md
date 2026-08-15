# Secondlayer OSS — one-box self-host

Postgres + one Secondlayer container. Optional bundled Stacks / Bitcoin.

## App services (external node)

- Mainnet, full history: 8 GB RAM, 600 GB SSD
- Testnet/devnet: 8 GB RAM, 100 GB SSD

Mainnet is the large one: the reference index measures ~500 GB at 8.77M blocks
(~250 GB of blocks/transactions/events, the rest decoded). Budget ~3 GB per
100k blocks for core datasets, ~6 GB with a broad decoder set.

## Full stack (bitcoind + stacks-node)

- Floor: 96 GB RAM, 2.5 TB NVMe
- Recommended: 128 GB RAM, 3 TB NVMe

The chain dominates: Stacks chainstate alone measures 1.3 TB, plus bitcoind,
plus the index above.

The runtime enforces these floors at start and refuses to boot below them.
`SECONDLAYER_ALLOW_UNDERSIZED=true` downgrades the refusal to a warning, so a
box that is already undersized can still be restarted.

No Hiro-REST "light" mode.

## Quick start

```bash
secondlayer init --network mainnet
# Copy INSTANCE_TOKEN, SECONDLAYER_SECRETS_KEY, STREAMS_SIGNING_PRIVATE_KEY into .env

docker compose up -d
secondlayer observer --mode indexer --endpoint secondlayer:3700
secondlayer bootstrap --against <manifest>
secondlayer verify all --against <manifest>
```

API: `http://127.0.0.1:3800`. Observer: `127.0.0.1:3700`.

| Profile | Command |
| --- | --- |
| External Stacks node | `docker compose up -d` |
| Bundled Stacks, public Bitcoin | `docker compose --profile stacks-node up -d` |
| Bundled Stacks + bitcoind | `docker compose --profile full-node up -d` |

Required non-secrets: `NETWORK`, `DATABASE_URL` (compose sets it), `NODE_MODE`, `DATA_DIR`, `API_PORT`, `INDEXER_PORT`. Secrets come from `secondlayer init`.

## Console (optional)

Web UI for the one-box instance. Off by default — the two-container promise is unchanged.

```bash
docker compose --profile console up -d
secondlayer console   # opens http://localhost:3801/console
```

Port `3801` (override: `CONSOLE_PORT`). Env: `SL_API_URL` (compose sets `http://secondlayer:3800`), `INSTANCE_TOKEN`, `CONSOLE_TOKEN`.

Token gate: open on loopback or when no token is set; remote access requires `CONSOLE_TOKEN` (falls back to `INSTANCE_TOKEN`).

### Serving the console on a public domain

The token gate is the floor. If your console is reachable from the internet
(`console.example.com`, `example.com/console`), put your reverse proxy's auth
in front of it as well — the console is plain HTTP behind the proxy, so any of
these work unchanged:

Caddy (basic auth; hash via `caddy hash-password`):

```caddy
example.com {
  handle /console* {
    basic_auth {
      ops $2a$14$...hash...
    }
    reverse_proxy console:3801
  }
}
```

- **Cloudflare Access** — put the `/console` path behind an Access policy
  (email/SSO allowlist); the origin stays token-gated as a second layer.
- **Tailscale** — don't publish the port at all; bind the console to the
  tailnet and skip public exposure entirely.

Team-scoped console logins (per-user tokens) are deliberately not a feature
yet — one instance, one token, your proxy decides who reaches it.

Split multi-container layout: `docker-compose.split.yml`.
