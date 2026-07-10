import type { Database } from "@secondlayer/shared/db";
import {
	listContractsPendingAbi,
	recordContractDeploy,
	setContractAbi,
} from "@secondlayer/shared/db/queries/contracts";
import { logger } from "@secondlayer/shared/logger";
import type { StacksNodeClient } from "@secondlayer/shared/node/client";
import {
	type AbiContract,
	classifyContract,
	parseDeclaredStandards,
} from "@secondlayer/stacks/clarity";
import type { Kysely } from "kysely";

/**
 * Contract registry worker — populates `contracts` for trait-based discovery.
 * Decoupled from the hot persist path: it scans `transactions` for
 * `smart_contract` deploys (via the partial index) and records any not yet
 * registered, then fetches + classifies ABIs for pending rows. The same two
 * steps drive both go-forward sync and historical backfill (B1c).
 */

/**
 * Discover contract deploys not yet in the registry and record them. Anti-joins
 * against `contracts` (newest-first) so it's self-progressing: new tip deploys
 * are registered immediately and historical deploys drain over successive ticks,
 * with no cursor to track. Uses the partial index on
 * `transactions (contract_id) WHERE type='smart_contract'`.
 */
export async function discoverDeploys(
	db: Kysely<Database>,
	opts: { limit?: number } = {},
): Promise<number> {
	const rows = await db
		.selectFrom("transactions")
		.select(["contract_id", "sender", "block_height"])
		.where("type", "=", "smart_contract")
		.where("contract_id", "is not", null)
		// Anti-join against CANONICAL rows only: a contract flipped non-canonical
		// by a reorg is re-selected here once its deploy tx exists on the new
		// fork, and recordContractDeploy's upsert re-canonicalizes it (one-shot —
		// the row is canonical again on the next tick, so it drops back out).
		.where((eb) =>
			eb.not(
				eb.exists(
					eb
						.selectFrom("contracts")
						.select("contracts.contract_id")
						.whereRef("contracts.contract_id", "=", "transactions.contract_id")
						.where("contracts.canonical", "=", true),
				),
			),
		)
		.orderBy("block_height", "desc")
		.limit(opts.limit ?? 500)
		.execute();

	let recorded = 0;
	for (const row of rows) {
		if (!row.contract_id) continue;
		await recordContractDeploy(db, {
			contractId: row.contract_id,
			deployer: row.sender,
			blockHeight: Number(row.block_height),
		});
		recorded++;
	}
	return recorded;
}

/**
 * Fetch + classify ABIs for contracts awaiting one. Resilient: a contract whose
 * ABI can't be fetched/parsed is marked `failed`/`unparseable` and skipped — it
 * never wedges the worker. Inferred standards (shape) + declared standards
 * (source `impl-trait`) are merged.
 */
export async function processPendingAbis(
	db: Kysely<Database>,
	node: StacksNodeClient,
	opts: { limit?: number } = {},
): Promise<{ fetched: number; failed: number }> {
	const pending = await listContractsPendingAbi(db, opts.limit ?? 50);
	let fetched = 0;
	let failed = 0;

	for (const contract of pending) {
		let abi: AbiContract | null = null;
		try {
			abi = (await node.getContractAbi(contract.contract_id)) as AbiContract;
		} catch (err) {
			await setContractAbi(db, contract.contract_id, {
				abi: null,
				status: "failed",
			});
			failed++;
			logger.debug("contract ABI fetch failed", {
				contract: contract.contract_id,
				error: err instanceof Error ? err.message : String(err),
			});
			continue;
		}

		const inferred = abi ? classifyContract(abi) : [];

		// Declared traits come from source (ABI/RPC don't carry them). Best-effort.
		let declared: string[] = [];
		try {
			const source = await node.getContractSource(contract.contract_id);
			if (source) declared = parseDeclaredStandards(source);
		} catch {
			// Source unavailable — declared stays empty, inferred still applies.
		}

		await setContractAbi(db, contract.contract_id, {
			abi,
			status: abi ? "fetched" : "unparseable",
			inferredStandards: inferred,
			declaredTraits: declared,
		});
		fetched++;
	}

	return { fetched, failed };
}
