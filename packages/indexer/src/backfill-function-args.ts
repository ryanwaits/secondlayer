#!/usr/bin/env bun
/**
 * Un-double-encode `transactions.function_args` (and the reorg archive).
 *
 * Every row written before 2026-08-12 went through
 * `function_args: JSON.stringify(args)` into a jsonb column, so postgres stored
 * a JSON *string* containing JSON rather than an array — 14.4M rows at
 * `jsonb_typeof = 'string'`. The writers are fixed (`parser.ts`,
 * `repair-transactions.ts`); this repairs the history behind them.
 *
 * The repair is `function_args = function_args #>> '{}'` cast back to jsonb:
 * `#>> '{}'` extracts a jsonb string's text content, which for these rows IS
 * the original JSON document. Only rows where `jsonb_typeof = 'string'` are
 * touched, so the statement is idempotent and safe to re-run — an
 * already-correct array row is never rewritten, and a row written by the fixed
 * ingest path mid-backfill is skipped rather than corrupted.
 *
 * Batched by primary-key range with a bounded statement per batch: this table
 * is live under ingest, so one 14.4M-row UPDATE would hold locks and bloat WAL
 * for the duration. Progress is derived from the data itself (rows still
 * string-typed), so an interrupted run resumes by simply being run again.
 *
 * Usage:
 *   bun run packages/indexer/src/backfill-function-args.ts            # dry-run
 *   bun run packages/indexer/src/backfill-function-args.ts --apply
 *   bun run packages/indexer/src/backfill-function-args.ts --apply --table transactions_archive
 */
import { closeDb, getSourceDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";

type TargetTable = "transactions" | "transactions_archive";

const DEFAULT_BATCH_ROWS = 20_000;

function parseArgs(argv: string[]): {
	apply: boolean;
	table: TargetTable;
	batchRows: number;
} {
	let apply = false;
	let table: TargetTable = "transactions";
	let batchRows = DEFAULT_BATCH_ROWS;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--apply") apply = true;
		else if (arg === "--table") {
			const value = argv[++i];
			if (value !== "transactions" && value !== "transactions_archive") {
				throw new Error(
					`--table must be transactions or transactions_archive, got ${value}`,
				);
			}
			table = value;
		} else if (arg === "--batch-rows") batchRows = Number(argv[++i]);
	}
	if (!Number.isSafeInteger(batchRows) || batchRows <= 0) {
		throw new Error(`invalid --batch-rows: ${batchRows}`);
	}
	return { apply, table, batchRows };
}

async function countStringTyped(
	db: ReturnType<typeof getSourceDb>,
	table: TargetTable,
): Promise<number> {
	const { rows } = await sql<{ count: string }>`
		SELECT COUNT(*) AS count
		FROM ${sql.table(table)}
		WHERE function_args IS NOT NULL
			AND jsonb_typeof(function_args) = 'string'
	`.execute(db);
	return Number(rows[0]?.count ?? 0);
}

/**
 * One bounded batch. Selecting the ids first (rather than
 * `UPDATE ... LIMIT`, which postgres does not support) keeps each statement's
 * lock footprint to exactly the rows it rewrites.
 */
async function repairBatch(
	db: ReturnType<typeof getSourceDb>,
	table: TargetTable,
	batchRows: number,
): Promise<number> {
	const idColumn = table === "transactions" ? "tx_id" : "archive_id";
	const { rows } = await sql<{ repaired: number | string }>`
		WITH candidates AS (
			SELECT ${sql.ref(idColumn)} AS id
			FROM ${sql.table(table)}
			WHERE function_args IS NOT NULL
				AND jsonb_typeof(function_args) = 'string'
			LIMIT ${batchRows}
		)
		UPDATE ${sql.table(table)} AS t
			 SET function_args = (t.function_args #>> '{}')::jsonb
		 FROM candidates
		WHERE t.${sql.ref(idColumn)} = candidates.id
		RETURNING 1 AS repaired
	`.execute(db);
	return rows.length;
}

async function main(): Promise<void> {
	const { apply, table, batchRows } = parseArgs(process.argv.slice(2));
	const db = getSourceDb();

	const before = await countStringTyped(db, table);
	console.log(`table            ${table}`);
	console.log(`double-encoded   ${before} rows`);

	if (before === 0) {
		console.log("\nNothing to repair.");
		await closeDb();
		return;
	}

	if (!apply) {
		// Show what the repair produces for one row, so the operator can eyeball
		// the transformation before rewriting millions of rows.
		const { rows: sample } = await sql<{
			before: string;
			after: string;
			after_type: string;
		}>`
			SELECT
				function_args::text AS before,
				(function_args #>> '{}')::jsonb::text AS after,
				jsonb_typeof((function_args #>> '{}')::jsonb) AS after_type
			FROM ${sql.table(table)}
			WHERE function_args IS NOT NULL
				AND jsonb_typeof(function_args) = 'string'
			LIMIT 1
		`.execute(db);
		const row = sample[0];
		if (row) {
			console.log(`\nsample before    ${row.before.slice(0, 120)}`);
			console.log(`sample after     ${row.after.slice(0, 120)}`);
			console.log(`sample after typ ${row.after_type}`);
		}
		console.log("\n(dry-run — pass --apply to repair)");
		await closeDb();
		return;
	}

	let repaired = 0;
	const startedAt = Date.now();
	while (true) {
		const batch = await repairBatch(db, table, batchRows);
		if (batch === 0) break;
		repaired += batch;
		const elapsed = (Date.now() - startedAt) / 1000;
		console.log(
			`repaired ${repaired}/${before} (${Math.round(repaired / Math.max(elapsed, 1))} rows/s)`,
		);
	}

	const remaining = await countStringTyped(db, table);
	logger.info("Backfilled function_args", { table, repaired, remaining });
	console.log(`\nrepaired         ${repaired} rows`);
	console.log(`still string     ${remaining} rows`);
	if (remaining > 0) {
		// Not necessarily a failure: rows written by an OLD indexer image while
		// the backfill ran would land here. Re-run after the deploy completes.
		console.log(
			"\nRows remain string-typed — re-run after confirming every writer is on the fixed build.",
		);
		process.exitCode = 2;
	}

	await closeDb();
}

main().catch(async (err) => {
	console.error(
		"backfill-function-args failed:",
		err instanceof Error ? err.message : err,
	);
	await closeDb().catch(() => {});
	process.exit(1);
});
