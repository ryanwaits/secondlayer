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

`INSTANCE_TOKEN` is required here: the container process listens on `0.0.0.0`
— it has to, or the published port never reaches it — and a bind past loopback
with no token refuses to start. It does not follow that every call needs the
token. `API_PORT` is a publish spec, and compose hands the API that same value
as `API_PUBLISH_ADDR`, so with the default `127.0.0.1:3800` the `/v1` reads
(index, streams, subgraphs alike) stay keyless, and setting `API_PORT` to
`0.0.0.0:3800` makes each of them require `Authorization: Bearer
$INSTANCE_TOKEN`. Writes — `/api/subgraphs`, `/api/subscriptions`,
`/api/node`, `/status` — take the token either way, loopback included.

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

## Verifying what you pulled

Every published image is signed with [cosign](https://docs.sigstore.dev/) using
keyless (OIDC) signing — there is no long-lived key, and the signing identity is
the workflow that built it. Tagged releases also ship a `checksums.txt`
inventory of the exact image digests, plus its detached signature.

Get `checksums.txt`, `checksums.txt.sig`, and `checksums.txt.pem` from the
GitHub release for the tag (or from the `checksums` artifact on the
corresponding **OSS Images** workflow run).

**1. Verify the inventory**

```bash
cosign verify-blob checksums.txt \
  --signature checksums.txt.sig \
  --certificate checksums.txt.pem \
  --certificate-identity-regexp '^https://github\.com/ryanwaits/secondlayer/\.github/workflows/oss-images\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

`checksums.txt` lists one `<digest>  <image>` pair per service.

**2. Verify the image signature**

```bash
IMAGE=ghcr.io/ryanwaits/secondlayer-api
DIGEST=$(grep " $IMAGE$" checksums.txt | cut -d' ' -f1)

cosign verify "$IMAGE@$DIGEST" \
  --certificate-identity-regexp '^https://github\.com/ryanwaits/secondlayer/\.github/workflows/oss-images\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

**3. Check the digest you actually pulled**

Tags are mutable; digests are not. Pull by digest, then confirm what landed
locally matches the inventory:

```bash
docker pull "$IMAGE@$DIGEST"
docker image inspect "$IMAGE@$DIGEST" --format '{{index .RepoDigests 0}}'
```

**4. Inspect the SBOM and provenance**

Each image carries an SBOM and max-mode SLSA provenance as OCI attestations, so
you can see what is inside it and what built it:

```bash
cosign download sbom "$IMAGE@$DIGEST"
docker buildx imagetools inspect "$IMAGE@$DIGEST" --format '{{ json .Provenance }}'
```

Third-party images in `docker-compose.yml` (postgres, stacks-core, bitcoind) are
digest-pinned in this repo but signed by their own publishers, not by us — the
pin is what guarantees you get the bytes this release was tested against.
