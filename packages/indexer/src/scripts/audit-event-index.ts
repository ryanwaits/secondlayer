/**
 * Read-only audit: walks the whole canonical history and prints every height
 * whose raw `events.event_index` is not the event's 0-based position in its
 * block (`(tx_index, event_index)` order), the definition on
 * `STREAMS_CURSOR_VERSION` in shared/src/db-event-types.ts.
 *
 *   bun run packages/indexer/src/scripts/audit-event-index.ts [--from H] [--to H] [--chunk N] [--timeout-ms N]
 *
 * Reads the SOURCE/chain plane in `--chunk` block pieces (default 50,000), each
 * in a READ ONLY transaction with its own `statement_timeout` (default 60s), so
 * one slow chunk never holds a long query open. Writes nothing. A chunk that
 * times out is reported and the walk continues; the exit code is 1 when any
 * mismatch or timed-out chunk was found.
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import {
	findEventIndexMismatches,
	resolveChainTip,
} from "@secondlayer/shared/db/queries/integrity";

const DEFAULT_CHUNK = 50_000;
const DEFAULT_TIMEOUT_MS = 60_000;

function numberArg(name: string, fallback: number | null): number | null {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	const value = Number(process.argv[index + 1]);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`--${name} needs a non-negative integer`);
	}
	return value;
}

async function main(): Promise<number> {
	const db = getSourceDb();
	const chunk = numberArg("chunk", DEFAULT_CHUNK) as number;
	const timeoutMs = numberArg("timeout-ms", DEFAULT_TIMEOUT_MS) as number;
	const tip = await resolveChainTip(db, "canonical");
	if (tip === null) {
		console.log("[audit-event-index] no canonical blocks, nothing to audit");
		return 0;
	}
	const from = numberArg("from", 0) as number;
	const to = numberArg("to", tip) as number;

	let mismatched = 0;
	let timedOut = 0;
	for (let start = from; start <= to; start += chunk) {
		const end = Math.min(start + chunk - 1, to);
		try {
			const heights = await db.transaction().execute(async (trx) => {
				await sql`SET TRANSACTION READ ONLY`.execute(trx);
				await sql`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`.execute(
					trx,
				);
				return findEventIndexMismatches(trx, {
					fromHeight: start,
					toHeight: end,
				});
			});
			mismatched += heights.length;
			for (const height of heights) console.log(`mismatch ${height}`);
			console.error(
				`[audit-event-index] ${start}..${end}: ${heights.length} mismatching heights`,
			);
		} catch (err) {
			timedOut++;
			console.error(
				`[audit-event-index] ${start}..${end}: FAILED ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}
	console.error(
		`[audit-event-index] DONE ${from}..${to}: ${mismatched} mismatching heights, ${timedOut} failed chunks`,
	);
	return mismatched > 0 || timedOut > 0 ? 1 : 0;
}

if (import.meta.main) {
	main()
		.then(async (code) => {
			await closeDb();
			process.exit(code);
		})
		.catch(async (err) => {
			console.error(
				"audit-event-index failed:",
				err instanceof Error ? (err.stack ?? err.message) : err,
			);
			await closeDb().catch(() => {});
			process.exit(1);
		});
}
