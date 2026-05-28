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

/** Discover contract deploys from transactions and record them (idempotent). */
export async function discoverDeploys(
	db: Kysely<Database>,
	opts: { sinceBlock?: number; limit?: number } = {},
): Promise<number> {
	let q = db
		.selectFrom("transactions")
		.select(["contract_id", "sender", "block_height"])
		.where("type", "=", "smart_contract")
		.where("contract_id", "is not", null);
	if (opts.sinceBlock !== undefined) {
		q = q.where("block_height", ">", opts.sinceBlock);
	}
	const rows = await q
		.orderBy("block_height", "asc")
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
