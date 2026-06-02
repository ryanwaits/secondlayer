import { FT_TRANSFER_DECODER_NAME } from "@secondlayer/indexer/l2/decoder";
import {
	type IndexerStreamsTipBlock,
	getCurrentCanonicalTip,
	getFinalizedStacksHeight,
} from "@secondlayer/indexer/streams-tip";
import {
	DEFAULT_BTC_CONFIRMATIONS,
	finalizedBurnHeight,
} from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export type IndexTip = {
	block_height: number;
	/**
	 * Highest Stacks height treated as immutable: blocks at or below this are
	 * past the burn-confirmation finality boundary and safe to cache forever.
	 * Derived from the canonical burn tip, NOT the decoded tip — the decoded
	 * `block_height` can lag below this while the decoder catches up.
	 */
	finalized_height: number;
	lag_seconds: number;
};

export type IndexFinalizedHeightReader = (
	finalizedBurnHeight: number,
) => Promise<number>;

export type DecodedTipBlock = {
	block_height: number;
	ts: Date;
};

export type IndexTipProvider = () => IndexTip | Promise<IndexTip>;
export type IndexSourceTipReader = () => Promise<IndexerStreamsTipBlock | null>;
export type DecodedTipReader = () => Promise<DecodedTipBlock | null>;

function cursorBlockHeight(cursor: string | null): number | null {
	if (!cursor) return null;
	const [height] = cursor.split(":");
	if (!height || !/^(0|[1-9]\d*)$/.test(height)) return null;
	return Number(height);
}

export async function getDecoderCheckpointTipBlock(
	db: Kysely<Database> = getSourceDb(),
): Promise<DecodedTipBlock | null> {
	const checkpoint = await db
		.selectFrom("l2_decoder_checkpoints")
		.select("last_cursor")
		.where("decoder_name", "=", FT_TRANSFER_DECODER_NAME)
		.executeTakeFirst();
	const blockHeight = cursorBlockHeight(checkpoint?.last_cursor ?? null);
	if (blockHeight === null) return null;

	const block = await db
		.selectFrom("blocks")
		.select(["height", "timestamp"])
		.where("height", "=", blockHeight)
		.where("canonical", "=", true)
		.executeTakeFirst();
	if (!block) return null;

	return {
		block_height: Number(block.height),
		ts: new Date(Number(block.timestamp) * 1000),
	};
}

export async function getLatestDecodedTipBlock(
	db: Kysely<Database> = getSourceDb(),
): Promise<DecodedTipBlock | null> {
	const row = await db
		.selectFrom("decoded_events")
		.innerJoin("blocks", "blocks.height", "decoded_events.block_height")
		.select(["decoded_events.block_height", "blocks.timestamp"])
		.where("decoded_events.event_type", "=", "ft_transfer")
		.where("decoded_events.canonical", "=", true)
		.orderBy("decoded_events.block_height", "desc")
		.limit(1)
		.executeTakeFirst();

	if (!row) return null;

	return {
		block_height: Number(row.block_height),
		ts: new Date(Number(row.timestamp) * 1000),
	};
}

export function getIndexLagSeconds(tipTs: Date, nowMs = Date.now()): number {
	const lagSeconds = Math.round((nowMs - tipTs.getTime()) / 1000);
	return Math.max(0, lagSeconds);
}

export function createIndexTipProvider(opts?: {
	readSourceTip?: IndexSourceTipReader;
	readDecodedTip?: DecodedTipReader;
	readFinalizedHeight?: IndexFinalizedHeightReader;
	btcConfirmations?: number;
	now?: () => number;
	cacheTtlMs?: number;
}): IndexTipProvider {
	const readSourceTip = opts?.readSourceTip ?? getCurrentCanonicalTip;
	const readDecodedTip =
		opts?.readDecodedTip ??
		(async () => {
			const checkpointTip = await getDecoderCheckpointTipBlock();
			return checkpointTip ?? (await getLatestDecodedTipBlock());
		});
	const readFinalizedHeight =
		opts?.readFinalizedHeight ?? getFinalizedStacksHeight;
	const btcConfirmations = opts?.btcConfirmations ?? DEFAULT_BTC_CONFIRMATIONS;
	const now = opts?.now ?? Date.now;
	const cacheTtlMs = opts?.cacheTtlMs ?? 500;
	let cache: { expiresAt: number; value: IndexTip } | null = null;

	return async () => {
		const nowMs = now();
		if (cache && nowMs < cache.expiresAt) return cache.value;

		const sourceTip = await readSourceTip();
		if (!sourceTip) {
			throw new Error("Index tip unavailable: no canonical block found");
		}

		// Finality comes from the canonical burn tip, independent of how far the
		// decoder has progressed. block_height tracks the decoded tip, so it may
		// sit below finalized_height — the cache plan clamps to_height by the
		// decoded tip, so finalized pages near the boundary are conservatively
		// served as mutable (never the reverse), which is safe.
		const finalizedBurn = finalizedBurnHeight(
			sourceTip.burn_block_height,
			btcConfirmations,
		);
		const finalized_height = await readFinalizedHeight(finalizedBurn);

		const decodedTip = await readDecodedTip();
		const tipBlock = decodedTip ?? {
			block_height: sourceTip.block_height,
			ts: sourceTip.ts,
		};
		const value: IndexTip = {
			block_height: tipBlock.block_height,
			finalized_height,
			lag_seconds: getIndexLagSeconds(tipBlock.ts, nowMs),
		};

		cache = { expiresAt: nowMs + cacheTtlMs, value };
		return value;
	};
}

export const getIndexTip = createIndexTipProvider();
