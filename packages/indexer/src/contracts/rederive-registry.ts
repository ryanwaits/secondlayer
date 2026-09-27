/**
 * Manual, immediate trigger for contract-registry discovery — the re-derive
 * command for a repaired window's `contracts` rows.
 *
 * Unlike `decoded_events` / `sbtc_token_events` / `pox5_events` / the BNS event
 * logs, the contracts registry needs no delete-then-redecode and no height
 * window at all: `discoverDeploys` anti-joins `transactions` (type =
 * `smart_contract`) against `contracts` and registers whatever isn't there yet,
 * newest-first. Once `repair-from-journal.ts --apply` restores a height's
 * `smart_contract` deploy transactions, they are simply "not yet registered"
 * rows that the next scheduler tick (`contracts/scheduler.ts`, when
 * `CONTRACT_REGISTRY_ENABLED=true`) would pick up on its own — this script
 * just runs that same call once, immediately, instead of waiting on the
 * interval.
 *
 * `--limit` bounds one pass the same way the scheduler's tick does; run it
 * more than once (or raise `--limit`) if a repaired window has more deploys
 * than the default.
 *
 * Usage:
 *   bun run packages/indexer/src/contracts/rederive-registry.ts
 *   bun run packages/indexer/src/contracts/rederive-registry.ts --limit 2000
 */
import { closeDb, getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { discoverDeploys } from "./registry.ts";

function parseArgs(argv: string[]): { limit: number } {
	let limit = 500;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--limit") limit = Number(argv[++i]);
	}
	if (!Number.isSafeInteger(limit) || limit <= 0) {
		throw new Error("--limit must be a positive integer");
	}
	return { limit };
}

/** Core logic, extracted so a caller (tests, `--derive` tooling) can run it
 *  in-process without spawning the CLI. */
export async function rederiveRegistry(
	db: Kysely<Database>,
	opts: { limit: number },
): Promise<{ discovered: number; limitReached: boolean }> {
	const discovered = await discoverDeploys(db, { limit: opts.limit });
	return { discovered, limitReached: discovered === opts.limit };
}

async function main(): Promise<void> {
	const { limit } = parseArgs(process.argv.slice(2));
	const db = getSourceDb();
	const { discovered, limitReached } = await rederiveRegistry(db, { limit });
	console.log(
		`[rederive-registry] discovered ${discovered} contract deploy(s) not yet registered (limit ${limit})`,
	);
	if (limitReached) {
		console.log(
			"limit reached — there may be more; run again or raise --limit",
		);
	}
	await closeDb();
}

if (import.meta.main) {
	void main();
}
