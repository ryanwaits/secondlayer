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
	sbtc-first-block)
		echo ""
		echo "--- earliest sbtc-registry event block ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MIN(block_height) AS first_block FROM sbtc_events;" 2>&1 || true
		echo ""
		echo "--- earliest sbtc-token event block ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT MIN(block_height) AS first_block FROM sbtc_token_events;" 2>&1 || true
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
