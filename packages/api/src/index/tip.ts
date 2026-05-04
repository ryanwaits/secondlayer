import { FT_TRANSFER_DECODER_NAME } from "@secondlayer/indexer/l2/decoder";
import {
	type IndexerStreamsTipBlock,
	getCurrentCanonicalTip,
} from "@secondlayer/indexer/streams-tip";
import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

export type IndexTip = {
	block_height: number;
	lag_seconds: number;
};

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

		const decodedTip = await readDecodedTip();
		const tipBlock = decodedTip ?? {
			block_height: sourceTip.block_height,
			ts: sourceTip.ts,
		};
		const value = {
			block_height: tipBlock.block_height,
			lag_seconds: getIndexLagSeconds(tipBlock.ts, nowMs),
		};

		cache = { expiresAt: nowMs + cacheTtlMs, value };
		return value;
	};
}

export const getIndexTip = createIndexTipProvider();
