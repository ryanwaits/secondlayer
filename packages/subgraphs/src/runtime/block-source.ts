import { getSourceDb } from "@secondlayer/shared/db";
import type { SubgraphDefinition } from "../types.ts";
import { type BlockData, loadBlockRange } from "./batch-loader.ts";

/**
 * Where the subgraph runtime reads canonical chain data. Today it taps the
 * indexer Postgres directly (`PostgresBlockSource`); the re-point adds a
 * `PublicApiBlockSource` that consumes the Streams clock + Index data over
 * HTTP. `matchSources` / handlers / flush / outbox are unchanged — only the
 * loader + tip swap behind this seam.
 */
export interface BlockSource {
	/** Highest canonical block height available to process. */
	getTip(): Promise<number>;
	/** Canonical block data for [fromHeight, toHeight], keyed by height. */
	loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>>;
}

/** Reads directly from the shared indexer Postgres (the original behavior). */
export class PostgresBlockSource implements BlockSource {
	async getTip(): Promise<number> {
		const progress = await getSourceDb()
			.selectFrom("index_progress")
			.selectAll()
			.where("network", "=", process.env.NETWORK ?? "mainnet")
			.executeTakeFirst();
		return progress ? Number(progress.highest_seen_block) : 0;
	}

	loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>> {
		return loadBlockRange(getSourceDb(), fromHeight, toHeight);
	}
}

const postgresBlockSource = new PostgresBlockSource();

/**
 * Resolve the block source for a subgraph. Currently always Postgres (no
 * behavior change). Phase 1 wires `PublicApiBlockSource` here for eligible
 * subgraphs gated on `SUBGRAPH_SOURCE`.
 */
export function resolveBlockSource(
	_subgraph?: SubgraphDefinition,
): BlockSource {
	return postgresBlockSource;
}
