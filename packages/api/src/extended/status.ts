import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Context } from "hono";
import type { Kysely } from "kysely";
import { type IndexTip, getIndexTip } from "../index/tip.ts";

/** Matches packages/api package.json "version". */
export const EXTENDED_API_VERSION = "1.30.0";

export type ExtendedCanonicalBlock = {
	block_height: number;
	block_hash: string;
	index_block_hash: string | null;
	burn_block_height: number;
};

export type ExtendedTipProvider = () => IndexTip | Promise<IndexTip>;
export type ExtendedCanonicalBlockReader = (
	height: number,
) => Promise<ExtendedCanonicalBlock | null>;

export function createCanonicalBlockReader(
	db: Kysely<Database> = getSourceDb(),
): ExtendedCanonicalBlockReader {
	return async (height: number) => {
		const row = await db
			.selectFrom("blocks")
			.select(["height", "hash", "index_block_hash", "burn_block_height"])
			.where("height", "=", height)
			.where("canonical", "=", true)
			.executeTakeFirst();

		if (!row) return null;

		return {
			block_height: Number(row.height),
			block_hash: row.hash,
			index_block_hash: row.index_block_hash ?? null,
			burn_block_height: Number(row.burn_block_height),
		};
	};
}

export const readCanonicalBlock = createCanonicalBlockReader();

export type ExtendedStatusDeps = {
	getTip?: ExtendedTipProvider;
	readCanonicalBlock?: ExtendedCanonicalBlockReader;
};

export type ExtendedStatusBody = {
	server_version: string;
	status: "ready";
	chain_tip?: {
		block_height: number;
		block_hash: string;
		index_block_hash: string | null;
		burn_block_height: number;
	};
};

export function createStatusHandler(deps: ExtendedStatusDeps = {}) {
	const getTip = deps.getTip ?? getIndexTip;
	const readBlock = deps.readCanonicalBlock ?? readCanonicalBlock;

	return async (c: Context) => {
		const tip = await getTip();
		const body: ExtendedStatusBody = {
			server_version: `secondlayer-extended/${EXTENDED_API_VERSION}`,
			status: "ready",
		};

		// Empty chain (oss, no rows): omit chain_tip; stay ready. Do not invent zeros.
		if (tip.block_height > 0) {
			const block = await readBlock(tip.block_height);
			if (block) {
				body.chain_tip = {
					block_height: block.block_height,
					block_hash: block.block_hash,
					index_block_hash: block.index_block_hash,
					burn_block_height: block.burn_block_height,
				};
			}
		}

		return c.json(body);
	};
}
