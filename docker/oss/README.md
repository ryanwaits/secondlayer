# Secondlayer OSS — self-hosted stack

Full self-hosted Secondlayer: Postgres + API + indexer + subgraph processor,
optionally bundled with bitcoind + stacks-node.

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

## Quick start (app services only)

```bash
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD at minimum.

docker compose up -d postgres migrate api indexer subgraph-processor
```

The API is now at `http://localhost:3800`. By default it's open (OSS mode
default). To require a Bearer key on every request, set `API_KEY` in `.env`
and uncomment the line in `docker-compose.yml`.

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
docker compose up -d postgres migrate api indexer subgraph-processor
```

## Deploy a subgraph

With the CLI (`bun add -g @secondlayer/cli`):

```bash
# Point the CLI at the local OSS API — no session needed.
export SL_API_URL=http://localhost:3800
export SL_SERVICE_KEY=<your-key>   # only if API_KEY is set in the OSS .env

sl subgraphs deploy ./my-subgraph.ts
```

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
- Set `API_KEY` in `.env` if the API is reachable from untrusted networks.
- Don't publish port 8332 (bitcoind RPC) to the internet. Keep it localhost.
