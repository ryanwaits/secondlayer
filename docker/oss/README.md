# Secondlayer OSS — one-box self-host

Postgres + one Secondlayer container. Optional bundled Stacks / Bitcoin.

## App services (external node)

- 8 GB RAM, 100 GB SSD

## Full stack (bitcoind + stacks-node)

- 128 GB RAM, 2 TB NVMe

No Hiro-REST "light" mode.

## Quick start

```bash
sl init --network mainnet
# Copy INSTANCE_TOKEN, SECONDLAYER_SECRETS_KEY, STREAMS_SIGNING_PRIVATE_KEY into .env

docker compose up -d
sl observer --mode indexer --endpoint secondlayer:3700
sl bootstrap --against <manifest>
sl verify all --against <manifest>
```

API: `http://127.0.0.1:3800`. Observer: `127.0.0.1:3700`.

| Profile | Command |
| --- | --- |
| External Stacks node | `docker compose up -d` |
| Bundled Stacks, public Bitcoin | `docker compose --profile stacks-node up -d` |
| Bundled Stacks + bitcoind | `docker compose --profile full-node up -d` |

Required non-secrets: `NETWORK`, `DATABASE_URL` (compose sets it), `NODE_MODE`, `DATA_DIR`, `API_PORT`, `INDEXER_PORT`. Secrets come from `sl init`.

Split multi-container layout: `docker-compose.split.yml`.
