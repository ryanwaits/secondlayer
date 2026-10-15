/**
 * One-shot re-classification of stored contract ABIs.
 *
 * `classifyContract` only runs when an ABI is fetched, so contracts fetched
 * before a classifier fix keep stale `inferred_standards`. This re-runs it over
 * every stored ABI and rewrites rows whose result changed. Changed rows get a
 * fresh `abi_fetched_at`, which /v1/contracts serves as `classified_at`, so
 * hosted tenants polling `classified_after` pick them up.
 *
 * Usage:
 *   bun run packages/indexer/src/contracts/reclassify-registry.ts --dry-run
 *   bun run packages/indexer/src/contracts/reclassify-registry.ts --batch 500
 *   docker exec secondlayer-indexer-1 bun run packages/indexer/src/contracts/reclassify-registry.ts --dry-run
 */
import { closeDb, getSourceDb } from "@secondlayer/shared/db";
import { setInferredStandards } from "@secondlayer/shared/db/queries/contracts";
import type { Database } from "@secondlayer/shared/db/schema";
import {
	type AbiContract,
	classifyContract,
} from "@secondlayer/stacks/clarity";
import type { Kysely } from "kysely";

interface Options {
	batch: number;
	dryRun: boolean;
}

export interface ReclassifyResult {
	scanned: number;
	changed: number;
	byStandard: Record<string, number>;
}

function parseArgs(argv: string[]): Options {
	let batch = 1000;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--dry-run") dryRun = true;
		else if (argv[i] === "--batch") batch = Number(argv[++i]);
	}
	if (!Number.isSafeInteger(batch) || batch <= 0) {
		throw new Error("--batch must be a positive integer");
	}
	return { batch, dryRun };
}

const sameSet = (a: string[], b: string[]): boolean =>
	a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Core logic, extracted so tests can run it in-process. */
export async function reclassifyRegistry(
	db: Kysely<Database>,
	{ batch = 1000, dryRun = false }: Partial<Options> = {},
): Promise<ReclassifyResult> {
	const result: ReclassifyResult = { scanned: 0, changed: 0, byStandard: {} };
	let after = "";
	for (;;) {
		const rows = await db
			.selectFrom("contracts")
			.select(["contract_id", "abi", "inferred_standards"])
			.where("abi_status", "=", "fetched")
			.where("abi", "is not", null)
			.where("contract_id", ">", after)
			.orderBy("contract_id")
			.limit(batch)
			.execute();
		if (rows.length === 0) break;
		for (const row of rows) {
			result.scanned++;
			const next = classifyContract(row.abi as AbiContract);
			if (sameSet(next, row.inferred_standards)) continue;
			result.changed++;
			for (const id of next) {
				result.byStandard[id] = (result.byStandard[id] ?? 0) + 1;
			}
			if (!dryRun) await setInferredStandards(db, row.contract_id, next);
		}
		after = rows[rows.length - 1].contract_id;
	}
	return result;
}

async function main(): Promise<void> {
	const opts = parseArgs(process.argv.slice(2));
	const db = getSourceDb();
	try {
		const r = await reclassifyRegistry(db, opts);
		console.log(
			`[reclassify-registry]${opts.dryRun ? " (dry run)" : ""} scanned ${r.scanned}, changed ${r.changed}`,
		);
		for (const [id, n] of Object.entries(r.byStandard)) {
			console.log(`  ${id}: ${n}`);
		}
	} finally {
		await closeDb();
	}
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
