import type { Database } from "@secondlayer/shared/db";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { SubgraphDefinition } from "../types.ts";
import {
	factoryDiscoverers,
	resolveTraitContracts,
} from "./block-processor.ts";

/**
 * Trait and factory membership for one catch-up batch, read once instead of
 * once per block. Lives for a single batch iteration of the catch-up walk and
 * is dropped with it, so it never outlives a reorg (a reorg aborts the walk).
 *
 * - Trait sets resolve as of the batch's top height, like the webhook replay:
 *   membership only grows, and a contract has no events before its deploy
 *   block, so the extra members never match an earlier block.
 * - Factory addresses keep their reveal height: an address revealed later in
 *   the batch must not match an earlier block.
 */
export type BatchMembership = {
	traitsAsOf(height: number): Map<string, ReadonlySet<string>>;
	factoryAsOf(height: number): Map<string, Set<string>>;
	/** Record a committed block's discoveries. */
	addDiscoveries(
		height: number,
		discovered: Array<{ sourceName: string; address: string }>,
	): void;
};

/** `factoryRows`: discovering source -> address -> reveal height. */
export function createBatchMembership(
	traits: Map<string, ReadonlySet<string>>,
	factoryRows: Map<string, Map<string, number>>,
): BatchMembership {
	return {
		traitsAsOf: () => new Map(traits),
		factoryAsOf(height) {
			const out = new Map<string, Set<string>>();
			for (const [source, addresses] of factoryRows) {
				const set = new Set<string>();
				for (const [address, revealed] of addresses) {
					if (revealed <= height) set.add(address);
				}
				out.set(source, set);
			}
			return out;
		},
		addDiscoveries(height, discovered) {
			for (const { sourceName, address } of discovered) {
				const addresses = factoryRows.get(sourceName) ?? new Map();
				if (!addresses.has(address)) addresses.set(address, height);
				factoryRows.set(sourceName, addresses);
			}
		},
	};
}

export async function loadBatchMembership(
	subgraph: SubgraphDefinition,
	opts: { topHeight: number; schemaName: string; db: Kysely<Database> },
): Promise<BatchMembership> {
	const { topHeight, schemaName, db } = opts;
	const traits = await resolveTraitContracts(subgraph, topHeight);
	const factoryRows = new Map<string, Map<string, number>>();
	const discoverers = factoryDiscoverers(subgraph);
	for (const source of discoverers) factoryRows.set(source, new Map());
	if (discoverers.size > 0) {
		try {
			const rows = await sql<{
				source_name: string;
				address: string;
				block_height: string | number;
			}>`
				SELECT source_name, address, block_height
				FROM ${sql.raw(`"${schemaName}"."_factory_addresses"`)}
				WHERE source_name IN (${sql.join([...discoverers])})
					AND block_height <= ${topHeight}
			`.execute(db);
			for (const row of rows.rows) {
				factoryRows
					.get(row.source_name)
					?.set(row.address, Number(row.block_height));
			}
		} catch {
			// Table absent (first deploy before DDL): empty sets, as per-block
			// resolution treats it.
		}
	}
	return createBatchMembership(traits, factoryRows);
}
