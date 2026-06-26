# Launch runbook (2026-05-27)

Day-of operations + the 24h pre-launch dry run. Keep this open in a tab.

---

## Topology

| Surface | Where | How to reach |
|---|---|---|
| Web | Vercel (auto-deploys from `main`) | `https://www.secondlayer.tools/` |
| API + indexer + l2-decoder + provisioner + agent + caddy + postgres | Hetzner box `app-server` | `ssh ryan@claude-mini` then `ssh app-server` |
| Repo on prod | `/opt/secondlayer` | `cd /opt/secondlayer/docker` for compose ops |
| Container registry | GHCR | `ghcr.io/ryanwaits/secondlayer-{indexer,api,worker,agent,provisioner}:<sha>` |
| Object store | Cloudflare R2 (parquet datasets, streams bulk dumps) | bucket envs in `/opt/secondlayer/docker/.env` |
| External status URL | https://api.secondlayer.tools/public/status (JSON) + https://www.secondlayer.tools/status (HTML) | both behind caddy → api container |

Deploys happen via GH Actions → `appleboy/ssh-action` → `docker compose recreate`.

---

## Pre-launch (T-24h)

```bash
# 1. Index returning data
curl -s "https://api.secondlayer.tools/v1/index/events?event_type=ft_transfer&limit=1" \
  | jq -r '"index events: \((.events // []) | length) row(s)"'

# 2. Streams live
curl -s -H "Authorization: Bearer sk-sl_streams_status_public" \
  "https://api.secondlayer.tools/v1/streams/tip" | jq

# 3. Status: all decoders healthy
curl -s https://api.secondlayer.tools/public/status \
  | jq '{status, decoders: [.index.decoders[] | {decoder, status, lagSeconds}]}'

# 4. SEO basics
curl -s https://www.secondlayer.tools/sitemap.xml | grep -c '<loc>'   # ≥14
curl -s https://www.secondlayer.tools/robots.txt | head -1
curl -sI https://www.secondlayer.tools/some-bogus-path | head -3      # 404 from app
curl -s https://www.secondlayer.tools/ | grep -oE 'og:image[^>]*content="[^"]*"' | head -1

# 5. www canonical (no apex redirect loop)
curl -sI https://secondlayer.tools/ | head -3   # 307 → www
curl -sI https://www.secondlayer.tools/ | head -3   # 200
```

Anything red → fix or document a contingency before T-0.

---

## Day-of (T-0 → T+4h)

1. Post the tweet thread (`docs/marketing/launch-thread.md`).
2. Pin the thread.
3. Tail prod for 4h:
   ```bash
   ssh ryan@claude-mini "ssh app-server 'cd /opt/secondlayer/docker && docker compose logs -f --tail=50 api indexer l2-decoder' 2>&1" | grep -iE "error|warn|5\d\d "
   ```
4. Watch CPU/mem on Hetzner box (`htop` or whatever).
5. Refresh `/public/status` every few minutes. If `status: degraded`, jump to symptom table.

---

## Symptom → action

| Symptom | First check | Fix |
|---|---|---|
| `/public/status` reports `status: degraded` | `curl /public/status \| jq '.services, .index.decoders'` | jump to whichever sub-service is `unavailable`/`degraded` |
| `api` service `unavailable` | `docker compose logs --tail=100 api` | usually a postgres connection blip; restart api: `docker compose restart api` |
| `database` `unavailable` | `docker compose ps postgres` | restart postgres `docker compose restart postgres`; if disk-full, free space first |
| `indexer` `unavailable` | `docker compose logs --tail=100 indexer` | restart `docker compose restart indexer` |
| `l2_decoder` `degraded` (one decoder lagging) | `docker compose logs --tail=200 l2-decoder \| grep error` | restart `docker compose restart l2-decoder`; the C.5 healthcheck change makes "no events to process" report healthy, so `degraded` here means a decoder genuinely fell behind |
| Any decoder errors loop on `RangeError` / `TypeError` | logs again | latest indexer rev should be ≥1.3.6; if older container stuck, pull tag manually: `DEPLOY_IMAGE_OWNER=ryanwaits DEPLOY_IMAGE_TAG=<sha> docker compose up -d --no-deps <service>` |
| Streams API returns 5xx | `docker compose logs --tail=100 api \| grep 5\d\d` | check rate-limit middleware (`SlidingWindow` is in-memory; restart api if stuck) |
| Subscriptions deliveries failing | `/platform/subgraphs/<name>/subscriptions/<id>` shows DLQ counts | check user's webhook endpoint; if our side, `docker compose logs --tail=200 api \| grep emitter` |
| 5xx spike on `/v1/streams/events` | check api logs + EXPLAIN suspect query | the `events_contract_event_contract_id_idx` migration (0073) must be applied; verify on prod: `\di+ events_contract_event_contract_id_idx` |
| Vercel returning 5xx on `www.secondlayer.tools` | check Vercel dashboard | usually rebuild + redeploy from latest `main` commit |
| `status.secondlayer.tools` 404 | DNS / Vercel domain config | the subdomain must point at the Vercel app; verify CNAME |

---

## Rollback

If a deploy makes prod worse and the fix isn't obvious in <10 min:

```bash
ssh ryan@claude-mini "ssh app-server 'cd /opt/secondlayer/docker'"

# 1. Find the last green tag
git -C /opt/secondlayer log --oneline -10

# 2. Roll containers back to the previous SHA's image
DEPLOY_IMAGE_OWNER=ryanwaits DEPLOY_IMAGE_TAG=<prev-sha> \
  docker compose up -d --no-deps api indexer l2-decoder

# 3. Verify
curl https://api.secondlayer.tools/public/status | jq .status
```

For web: revert via Vercel UI ("Promote to Production" on the previous deployment).

---

## Decoder restart cookbook

```bash
# Restart all
docker compose restart l2-decoder

# Restart only when stuck on a specific decoder error
docker compose stop l2-decoder
docker compose rm -f l2-decoder
docker compose up -d l2-decoder

# Watch the recreate
docker compose logs -f --tail=20 l2-decoder | grep -iE "progress|error"
```

To reset a checkpoint (use sparingly — re-decodes from the new cursor):

```sql
-- example: re-decode bns from genesis
UPDATE l2_decoder_checkpoints
SET last_cursor = '167537:0', updated_at = now()
WHERE decoder_name = 'l2.bns.v1';
```

---

## Who to ping

- Self-host: `ryan@…` (you)
- Hetzner support: dashboard + ticket if box-level issue
- Vercel support: dashboard if domain/edge issue
- Cloudflare R2: dashboard if bucket access issue

For inbound user questions on launch day: triage in DMs first, don't promise SLAs you can't keep.

---

## Post-launch (T+24h)

- [ ] Snapshot uptime monitor: ≥99.9% over the 24h window
- [ ] Read every reply on the tweet thread
- [ ] Tally inbound: how many signups? Which datasets got the most curl traffic?
- [ ] Update memory project_may_27_launch_sprint.md with launch outcomes
- [ ] Backlog: anything users hit that wasn't in the runbook
