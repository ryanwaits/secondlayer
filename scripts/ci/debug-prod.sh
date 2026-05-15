#!/usr/bin/env bash
set -e

TARGET="${TARGET:-subgraph-processor}"
echo "=== target: $TARGET ==="

case "$TARGET" in
	subgraph-processor|full)
		echo ""
		echo "--- docker ps -a (subgraph-processor) ---"
		docker ps -a --filter name=subgraph-processor --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" || true
		echo ""
		echo "--- docker logs --tail 200 secondlayer-subgraph-processor-1 ---"
		docker logs --tail 200 secondlayer-subgraph-processor-1 2>&1 || true
		;;
esac

case "$TARGET" in
	all-containers|full)
		echo ""
		echo "--- docker ps -a (all) ---"
		docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" || true
		;;
esac

case "$TARGET" in
	service-heartbeats|full)
		echo ""
		echo "--- service_heartbeats table ---"
		docker exec secondlayer-postgres-1 psql -U secondlayer -d secondlayer \
			-c "SELECT name, updated_at, now() - updated_at AS age FROM service_heartbeats ORDER BY updated_at DESC NULLS LAST;" || true
		;;
esac

case "$TARGET" in
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

echo ""
echo "=== done ==="
