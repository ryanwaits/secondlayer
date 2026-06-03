/**
 * Sprint-0 bench (S0.T1): DB-tap data-acquisition throughput.
 *
 * Measures how fast the CURRENT subgraph path pulls block data — the
 * `loadBlockRange(getSourceDb(), …)` batch read over the indexer Postgres —
 * in blocks/sec over a fixed height range, batched like catch-up.
 *
 * Run in-cluster (same host/network as the source DB) for a fair comparison
 * against http-source.ts. Reads SOURCE_DATABASE_URL/DATABASE_URL from env.
 *
 *   bun run packages/subgraphs/bench/db-tap.ts --from H1 --to H2 [--batch-size 500]
 */
import { getSourceDb } from "@secondlayer/shared/db";
import { loadBlockRange } from "../src/runtime/batch-loader.ts";

function arg(name: string, def?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
	const from = Number(arg("from"));
	const to = Number(arg("to"));
	const batchSize = Number(arg("batch-size", "500"));
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
		console.error("usage: bun db-tap.ts --from H1 --to H2 [--batch-size 500]");
		process.exit(1);
	}

	const db = getSourceDb();
	let blocksLoaded = 0;
	let txs = 0;
	let events = 0;
	let batches = 0;

	const t0 = performance.now();
	for (let h = from; h <= to; h += batchSize) {
		const end = Math.min(h + batchSize - 1, to);
		const batch = await loadBlockRange(db, h, end);
		batches++;
		for (const bd of batch.values()) {
			blocksLoaded++;
			txs += bd.txs.length;
			events += bd.events.length;
		}
	}
	const wallSec = (performance.now() - t0) / 1000;
	const span = to - from + 1;

	console.log(
		JSON.stringify(
			{
				path: "db-tap",
				from,
				to,
				span,
				batchSize,
				batches,
				blocksLoaded,
				txs,
				events,
				wallSec: +wallSec.toFixed(2),
				blocksPerSec: Math.round(span / wallSec),
				eventsPerSec: Math.round(events / wallSec),
			},
			null,
			2,
		),
	);

	await db.destroy();
}

void main();
