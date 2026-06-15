#!/usr/bin/env bash
#
# Stripe catalog setup — wire the billing catalog + webhook on the Stripe
# account we run on (the `default` / Second Layer account, verified as
# Waits Technologies LLC and branded Secondlayer).
#
# Idempotent. Drives the catalog setup + webhook wiring via the Stripe CLI
# against a named CLI profile (`stripe config --list`), then prints the env
# block to paste into your deploy secrets.
#
# What it does:
#   1. Upsert product + 4 tier prices via packages/api/scripts/stripe-setup.ts
#      (idempotent; corrects stale amounts by archiving + recreating).
#   2. Archive the vestigial `secondlayer_ai_eval_overage` price (dead feature).
#   3. Ensure a webhook endpoint at WEBHOOK_URL with the 5 handled events.
#   4. Emit STRIPE_SECRET_KEY / STRIPE_PRICE_* / STRIPE_WEBHOOK_SECRET.
#
# Usage:
#   # test mode (default) against the "default" CLI profile (Second Layer):
#   docker/scripts/stripe-migrate.sh
#
#   # override profile / webhook URL:
#   PROFILE=default WEBHOOK_URL=https://api.secondlayer.tools/api/webhooks/stripe \
#     docker/scripts/stripe-migrate.sh
#
#   # live mode — you must pass a live key (CLI masks rk_live in config):
#   LIVE=1 STRIPE_SECRET_KEY=rk_live_... docker/scripts/stripe-migrate.sh
#
set -euo pipefail

PROFILE="${PROFILE:-default}"
WEBHOOK_URL="${WEBHOOK_URL:-https://api.secondlayer.tools/api/webhooks/stripe}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

LIVE_FLAG=()
MODE="test"
if [[ "${LIVE:-}" == "1" ]]; then
  LIVE_FLAG=(--live)
  MODE="live"
fi

say() { printf '\033[1;36m→ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

say "Target profile: '$PROFILE'  (mode: $MODE)"

# ── Resolve the secret key for the TS setup script ──────────────────────
# Test keys are shown in full by `stripe config --list`; live rk_ keys are
# masked, so live runs must pass STRIPE_SECRET_KEY explicitly.
if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  if [[ "$MODE" == "live" ]]; then
    echo "ERROR: live mode needs STRIPE_SECRET_KEY=rk_live_... (config masks it)" >&2
    exit 1
  fi
  STRIPE_SECRET_KEY="$(stripe config --list | awk -v prof="$PROFILE" '
    /^\[/ { s=$0; gsub(/[][\x27]/,"",s); insec=(tolower(s)==tolower(prof)); next }
    insec && $1=="test_mode_api_key" { v=$3; gsub(/\x27/,"",v); print v; exit }')"
  if [[ -z "$STRIPE_SECRET_KEY" ]]; then
    echo "ERROR: no test_mode_api_key for profile '$PROFILE' in stripe config" >&2
    exit 1
  fi
  say "Resolved test key from CLI config for '$PROFILE'"
fi

# ── 1. Catalog (product + tier prices) ──────────────────────────────────
say "Upserting product + tier prices…"
SETUP_OUT="$(STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" bun run "$REPO_ROOT/packages/api/scripts/stripe-setup.ts")"
echo "$SETUP_OUT"
# Pull the emitted STRIPE_PRICE_* lines.
PRICE_ENV="$(printf '%s\n' "$SETUP_OUT" | grep -E '^STRIPE_PRICE_' || true)"

# ── 2. Archive the vestigial AI-eval overage price ──────────────────────
say "Archiving dead price secondlayer_ai_eval_overage (if present)…"
AI_PRICE_ID="$(stripe prices list ${LIVE_FLAG[@]+"${LIVE_FLAG[@]}"} --project-name "$PROFILE" \
  -d "lookup_keys[]=secondlayer_ai_eval_overage" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["data"][0]["id"] if d.get("data") else "")')"
if [[ -n "$AI_PRICE_ID" ]]; then
  stripe prices update "$AI_PRICE_ID" --active=false ${LIVE_FLAG[@]+"${LIVE_FLAG[@]}"} --project-name "$PROFILE" >/dev/null
  say "  archived $AI_PRICE_ID"
else
  say "  none found — skipping"
fi

# ── 3. Webhook endpoint ─────────────────────────────────────────────────
say "Ensuring webhook endpoint at ${WEBHOOK_URL}…"
EXISTING_WH="$(stripe webhook_endpoints list ${LIVE_FLAG[@]+"${LIVE_FLAG[@]}"} --project-name "$PROFILE" --limit 100 \
  | WEBHOOK_URL="$WEBHOOK_URL" python3 -c 'import sys,json,os; d=json.load(sys.stdin); print(next((w["id"] for w in d.get("data",[]) if w.get("url")==os.environ["WEBHOOK_URL"]), ""))')"

WEBHOOK_SECRET=""
if [[ -n "$EXISTING_WH" ]]; then
  warn "Endpoint already exists ($EXISTING_WH). Stripe only reveals the signing"
  warn "secret at creation — reuse the stored STRIPE_WEBHOOK_SECRET, or roll it"
  warn "in the dashboard (Webhooks → … → Roll secret) and update the env."
else
  CREATE_OUT="$(stripe webhook_endpoints create ${LIVE_FLAG[@]+"${LIVE_FLAG[@]}"} --project-name "$PROFILE" \
    --url "$WEBHOOK_URL" \
    -d "enabled_events[]=checkout.session.completed" \
    -d "enabled_events[]=customer.subscription.created" \
    -d "enabled_events[]=customer.subscription.updated" \
    -d "enabled_events[]=customer.subscription.deleted" \
    -d "enabled_events[]=invoice.paid")"
  WEBHOOK_SECRET="$(printf '%s' "$CREATE_OUT" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("secret",""))')"
  say "  created endpoint, captured signing secret"
fi

# ── 4. Emit env block ───────────────────────────────────────────────────
PUB_KEY="$(stripe config --list | awk -v prof="$PROFILE" -v f="${MODE}_mode_pub_key" '
  /^\[/ { s=$0; gsub(/[][\x27]/,"",s); insec=(tolower(s)==tolower(prof)); next }
  insec && $1==f { v=$3; gsub(/\x27/,"",v); print v; exit }')"

echo
echo "─── Paste into .env / deploy secrets ($MODE mode) ───"
echo "STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY"
[[ -n "$PUB_KEY" ]] && echo "# publishable (web): $PUB_KEY"
printf '%s\n' "$PRICE_ENV"
if [[ -n "$WEBHOOK_SECRET" ]]; then
  echo "STRIPE_WEBHOOK_SECRET=$WEBHOOK_SECRET"
else
  echo "STRIPE_WEBHOOK_SECRET=<reuse existing or roll in dashboard>"
fi
echo "──────────────────────────────────────────────────"
echo
warn "Don't forget the dashboard-only steps: verify as Waits Technologies LLC"
warn "(EIN), then Public details + statement descriptor + Branding → Secondlayer."
