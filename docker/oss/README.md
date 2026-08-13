# Secondlayer OSS — self-hosted stack

Full self-hosted Secondlayer: Postgres + API + indexer + decoder + subgraph
processor + subscription processor, optionally bundled with bitcoind +
stacks-node.

## Requirements

Running the chain yourself:
- **128 GB RAM** (bitcoind 32 GB, stacks-node 64 GB, headroom for PG/indexer)
- **2 TB NVMe SSD** (Bitcoin ~700 GB, Stacks ~200 GB, plus subgraph data)
- Modern x86_64 CPU (8+ cores recommended)
- 1 Gbps network (IBD downloads 700+ GB)

Running only the app services (pointing at an external Stacks node):
- 8 GB RAM
- 100 GB SSD
- Any modern CPU

There is no "light" mode that fetches from Hiro's REST API — it's too slow to
index anything useful. Run the full chain or use the hosted tier at
secondlayer.tools.

For **local contract development**, point the indexer at a fast
[Clarinet devnet](https://docs.hiro.so/stacks/clarinet) instead of a full
mainnet node — `sl devnet connect` wires it up in one step from inside any
clarinet project.

## Quick start (app services only)

```bash
sl instance init --network mainnet
# Copy the generated .env.local values into docker/oss/.env
# (INSTANCE_TOKEN, SECONDLAYER_SECRETS_KEY, STREAMS_SIGNING_PRIVATE_KEY).

docker compose --env-file .env up -d postgres migrate api indexer decoder subgraph-processor subscription-processor
```

`decoder` populates the semantic `decoded_events` table (transfers, mints,
burns, and contract **prints**) that powers `/v1/index` and chain
`print_event`/transfer subscriptions — without it, `decoded_events` stays empty
and chain subscriptions never match. `subscription-processor` is the webhook
delivery plane (chain-trigger evaluator + emitter); to run chain subscriptions
across both `api` and `subscription-processor`, set a shared
`SECONDLAYER_SECRETS_KEY` in `.env` (see `.env.example`). Omit both services for
raw-events-only indexing.

Writes stay tokened. `sl instance init` sets `SL_API_KEY` to the instance
token. Loopback reads stay open.

```bash
export SL_API_URL=http://127.0.0.1:3800
export SL_API_KEY=<INSTANCE_TOKEN>
sl subgraphs deploy ./subgraph.config.ts
```

Local catalog: `http://127.0.0.1:3800/console` and `GET /v1/instance`.

Streams reads accept the instance token or the seeded static key
(`sk-sl_streams_enterprise_test`).

To check the install end to end — migrations, an empty-chain response, labelled
Streams filters, Index field selection, a subgraph deploy, and a sink consumer
writing to your own Postgres:

```bash
bun run self-host:smoke
```

The API is now at `http://localhost:3800`. The container listens on `0.0.0.0`
and **refuses to start without `INSTANCE_TOKEN`**. Host publish defaults to
loopback (`127.0.0.1:3800`). Pass the token as `Authorization: Bearer …`.

To point the indexer at an external Stacks node's event observer, configure
that node's Config.toml with `endpoint = "<your-host>:3700"`.

## Full stack (include bitcoind + stacks-node)

```bash
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD and BITCOIN_RPC_PASSWORD (strong random).
# Then edit bitcoin.conf and Config.toml to match the new RPC password.

# Copy bitcoin.conf into the bitcoin data volume before first start:
mkdir -p ./data/bitcoin
cp bitcoin.conf ./data/bitcoin/bitcoin.conf
sudo chown -R 1000:1000 ./data/bitcoin

# 1. Start bitcoind — IBD takes 1-3 days depending on network + disk.
docker compose --profile node up -d bitcoind

# 2. Wait until bitcoind is past Stacks genesis:
docker compose exec bitcoind bitcoin-cli -rpcuser=stacks -rpcpassword=$BITCOIN_RPC_PASSWORD getblockcount
#    => 666050 or higher

# 3. Start stacks-node (syncs from bitcoind + Stacks p2p):
docker compose --profile node up -d stacks-node

# 4. Start app services (if not already running):
docker compose up -d postgres migrate api indexer decoder subgraph-processor subscription-processor
```

## Deploy a subgraph

With the CLI (`bun add -g @secondlayer/cli`):

```bash
# Point the CLI at the local OSS API — no session needed.
export SL_API_URL=http://localhost:3800
export SL_API_KEY=<INSTANCE_TOKEN>

sl subgraphs deploy ./my-subgraph.ts
```

For contract ABI scaffolds, `sl subgraphs scaffold <contract> -o my-subgraph.ts`
creates the module `package.json` and runs `bun install` by default. Use
`--no-install` only if you will run `bun install` manually before deploy.

Or via curl:

```bash
curl -X POST http://localhost:3800/api/subgraphs \
  -H "Content-Type: application/json" \
  -d @subgraph.json
```

## Query data

```bash
curl "http://localhost:3800/api/subgraphs/my-subgraph/events?_limit=10"
```

## Upgrade

```bash
git pull
docker compose build
docker compose up -d
```

## Security notes

- Change `POSTGRES_PASSWORD` and `BITCOIN_RPC_PASSWORD` before exposing any
  port publicly.
- `POSTGRES_PORT` and `INDEXER_PORT` default to `127.0.0.1:...` (localhost
  only). Remove the prefix to expose them, but consider whether you really
  need to.
- Set `INSTANCE_TOKEN` in `.env` (`openssl rand -hex 32`). Compose will not start the API without it.
- Don't publish port 8332 (bitcoind RPC) to the internet. Keep it localhost.
