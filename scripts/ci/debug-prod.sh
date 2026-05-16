#!/usr/bin/env bash
set -e

DEBUG_TARGET="${DEBUG_TARGET:-subgraph-processor}"
echo "=== target: $DEBUG_TARGET ==="

case "$DEBUG_TARGET" in
	subgraph-processor|full)
		echo ""
		echo "--- docker ps -a (subgraph-processor) ---"
		docker ps -a --filter name=subgraph-processor --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" || true
		echo ""
		echo "--- docker logs --tail 200 secondlayer-subgraph-processor-1 ---"
		docker logs --tail 200 secondlayer-subgraph-processor-1 2>&1 || true
		;;
esac

case "$DEBUG_TARGET" in
	all-containers|full)
		echo ""
		echo "--- docker ps -a (all) ---"
		docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" || true
		;;
esac

case "$DEBUG_TARGET" in
	service-heartbeats|full)
		echo ""
		echo "--- service_heartbeats table ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT name, updated_at, now() - updated_at AS age FROM service_heartbeats ORDER BY updated_at DESC NULLS LAST;" || true
		;;
esac

case "$DEBUG_TARGET" in
	subgraphs-state|full)
		echo ""
		echo "--- subgraphs (status + cursor) ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT name, status, last_processed_block, reindex_from_block, reindex_to_block, updated_at FROM subgraphs ORDER BY updated_at DESC LIMIT 20;" || true
		echo ""
		echo "--- subgraph_processing_stats (most recent rows) ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT subgraph_name, bucket_end, blocks_processed, total_time_ms, is_catchup FROM subgraph_processing_stats ORDER BY bucket_end DESC LIMIT 10;" || true
		;;
esac

case "$DEBUG_TARGET" in
	caddy)
		echo ""
		echo "--- docker ps caddy ---"
		docker ps -a --filter name=caddy --format "table {{.Names}}\t{{.Status}}" || true
		echo ""
		echo "--- docker logs --tail 200 secondlayer-caddy-1 ---"
		docker logs --tail 200 secondlayer-caddy-1 2>&1 | tail -200 || true
		;;
	reload-caddy)
		echo ""
		echo "--- caddy reload from /etc/caddy/Caddyfile ---"
		docker exec secondlayer-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 || true
		echo ""
		echo "--- docker logs --tail 30 secondlayer-caddy-1 (post-reload) ---"
		docker logs --tail 30 secondlayer-caddy-1 2>&1 | tail -30 || true
		;;
	restart-caddy)
		echo ""
		echo "--- docker restart secondlayer-caddy-1 ---"
		docker restart secondlayer-caddy-1 2>&1 || true
		sleep 8
		echo ""
		echo "--- docker logs --tail 40 secondlayer-caddy-1 (post-restart) ---"
		docker logs --tail 40 secondlayer-caddy-1 2>&1 | tail -40 || true
		;;
	flip-parquet-flags)
		ENV_FILE="/opt/secondlayer/docker/.env"
		echo ""
		echo "--- upserting publisher flags in $ENV_FILE ---"
		upsert() {
			local key="$1"
			local value="$2"
			if grep -qE "^${key}=" "$ENV_FILE"; then
				sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
				echo "  updated  ${key}=${value}"
			else
				printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
				echo "  appended ${key}=${value}"
			fi
		}
		upsert POX4_CALLS_PUBLISHER_ENABLED true
		upsert BNS_NAME_EVENTS_PUBLISHER_ENABLED true
		upsert BNS_NAMESPACE_EVENTS_PUBLISHER_ENABLED true
		upsert BNS_MARKETPLACE_EVENTS_PUBLISHER_ENABLED true
		echo ""
		echo "--- docker compose up -d --no-build indexer (re-creates with new env) ---"
		cd /opt/secondlayer/docker
		docker compose up -d --no-build indexer 2>&1 || true
		sleep 8
		echo ""
		echo "--- docker logs --tail 80 secondlayer-indexer-1 (post-recreate) ---"
		docker logs --tail 80 secondlayer-indexer-1 2>&1 | grep -E "publisher|disabled|Starting|enabled" | tail -50 || true
		;;
esac

case "$DEBUG_TARGET" in
	indexer-publishers)
		echo ""
		echo "--- indexer /health publisher state ---"
		docker exec secondlayer-indexer-1 curl -sS http://localhost:3700/health 2>&1 | \
			grep -oE '"[a-zA-Z]+Publisher":\{[^}]*\}' || true
		echo ""
		echo "--- recent publisher log lines ---"
		docker logs --tail 100 secondlayer-indexer-1 2>&1 | \
			grep -E "publisher: (exporting|published|disabled)|Starting .* publisher" | tail -30 || true
		;;
esac

case "$DEBUG_TARGET" in
	sbtc-first-block)
		echo ""
		echo "--- earliest sbtc-registry print_event in raw events table ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MIN(block_height) AS first_block, COUNT(*) AS total FROM events WHERE type IN ('smart_contract_event','contract_event') AND data->>'contract_identifier' = 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry';" 2>&1 || true
		echo ""
		echo "--- earliest sbtc-token ft event ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MIN(block_height) AS first_block, COUNT(*) AS total FROM events WHERE type IN ('ft_transfer_event','ft_mint_event','ft_burn_event') AND data->>'asset_identifier' LIKE 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::%';" 2>&1 || true
		;;
	stop-tenant-compute)
		echo ""
		echo "--- stop + rm sl-proc-2tbyrjby, sl-api-2tbyrjby (ghost compute) ---"
		docker rm -f sl-proc-2tbyrjby 2>&1 || true
		docker rm -f sl-api-2tbyrjby 2>&1 || true
		echo "  done. Postgres ghost containers left in place pending your call."
		;;
	run-backfills)
		echo ""
		echo "--- kicking off 4 detached backfills inside secondlayer-indexer-1 ---"
		docker exec -d secondlayer-indexer-1 sh -c \
			'bun run packages/indexer/src/datasets/backfill.ts pox-4-calls --from 7890000 --to 7960000 > /tmp/backfill-pox4-calls.log 2>&1'
		docker exec -d secondlayer-indexer-1 sh -c \
			'bun run packages/indexer/src/datasets/backfill.ts bns-namespace-events --from 160000 --to 170000 > /tmp/backfill-bns-namespace.log 2>&1'
		docker exec -d secondlayer-indexer-1 sh -c \
			'bun run packages/indexer/src/datasets/backfill.ts bns-marketplace-events --from 7800000 --to 7960000 > /tmp/backfill-bns-marketplace.log 2>&1'
		docker exec -d secondlayer-indexer-1 sh -c \
			'bun run packages/indexer/src/datasets/backfill.ts bns-name-events --from 160000 --to 7960000 > /tmp/backfill-bns-name.log 2>&1'
		echo "  4 backfill processes detached. Tail logs via target=backfill-progress"
		;;
	backfill-progress)
		echo ""
		for slug in pox4-calls bns-namespace bns-marketplace bns-name; do
			echo ""
			echo "--- /tmp/backfill-${slug}.log (last 5 lines) ---"
			docker exec secondlayer-indexer-1 tail -n 5 "/tmp/backfill-${slug}.log" 2>&1 || true
		done
		echo ""
		echo "--- backfill processes still running ---"
		docker exec secondlayer-indexer-1 sh -c 'ps -ef | grep "backfill.ts" | grep -v grep' 2>&1 || true
		;;
	ghost-tenants)
		echo ""
		echo "--- all containers (host-wide) ---"
		docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" || true
		echo ""
		echo "--- ghost tenant-mode containers (sl-* pattern) ---"
		docker ps -a --filter "name=^sl-" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" || true
		echo ""
		echo "--- tenants table row count (deprecated post-pivot) ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT count(*) AS tenants_rows, count(*) FILTER (WHERE status='active') AS active FROM tenants;" 2>&1 || true
		echo ""
		echo "--- ghost docker networks ---"
		docker network ls --filter "name=sl-" 2>&1 || true
		;;
	dataset-ranges)
		echo ""
		echo "--- finalized tip ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MAX(block_height) AS tip FROM blocks WHERE canonical = true;" 2>&1 || true
		echo ""
		echo "--- pox4_calls range ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MIN(block_height) AS first, MAX(block_height) AS last, COUNT(*) AS rows FROM pox4_calls;" 2>&1 || true
		echo ""
		echo "--- bns_name_events range ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MIN(block_height) AS first, MAX(block_height) AS last, COUNT(*) AS rows FROM bns_name_events;" 2>&1 || true
		echo ""
		echo "--- bns_namespace_events range ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MIN(block_height) AS first, MAX(block_height) AS last, COUNT(*) AS rows FROM bns_namespace_events;" 2>&1 || true
		echo ""
		echo "--- bns_marketplace_events range ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MIN(block_height) AS first, MAX(block_height) AS last, COUNT(*) AS rows FROM bns_marketplace_events;" 2>&1 || true
		;;
esac

case "$DEBUG_TARGET" in
	env-snapshot|full)
		echo ""
		echo "--- bench env snapshot ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT 'events' AS rel, count(*) AS rows FROM events UNION ALL SELECT 'blocks', count(*) FROM blocks UNION ALL SELECT 'subgraphs', count(*) FROM subgraphs;" 2>&1 || true
		echo ""
		echo "--- subgraphs currently reindexing ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT name, status, reindex_from_block, reindex_to_block FROM subgraphs WHERE status = 'reindexing';" 2>&1 || true
		echo ""
		echo "--- subgraph-processor resource limits ---"
		docker inspect secondlayer-subgraph-processor-1 --format '{{json .HostConfig}}' 2>&1 | head -c 600 || true
		echo ""
		echo "--- docker stats --no-stream subgraph-processor ---"
		docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" secondlayer-subgraph-processor-1 2>&1 || true
		;;
esac

case "$DEBUG_TARGET" in
	schema|full)
		echo ""
		echo "--- public schema tables ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer -c "\dt public.*" 2>&1 | head -80 || true
		echo ""
		echo "--- views vs subgraphs (renamed in migration 0015) ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT to_regclass('public.views') AS views_oid, to_regclass('public.subgraphs') AS subgraphs_oid;" 2>&1 || true
		echo ""
		echo "--- last 20 applied migrations ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT name, timestamp FROM kysely_migration ORDER BY timestamp DESC LIMIT 20;" 2>&1 || true
		;;
esac

echo ""
echo "=== done ==="
