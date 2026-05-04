import { getTargetDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import {
	FT_TRANSFER_DECODER_NAME,
	type L2DecoderName,
	L2_DECODER_EVENT_TYPES,
	L2_DECODER_NAMES,
} from "./storage.ts";

export type L2DecoderHealth = {
	status: "healthy" | "unhealthy";
	decoder: string;
	checkpoint: string | null;
	checkpoint_block_height: number | null;
	tip_block_height: number | null;
	lag_seconds: number | null;
	last_decoded_at: string | null;
	writes_recent: boolean;
};

export type L2DecodersHealth = {
	status: "healthy" | "unhealthy";
	decoders: L2DecoderHealth[];
};

function cursorBlockHeight(cursor: string | null): number | null {
	if (!cursor) return null;
	const [height] = cursor.split(":");
	if (!height || !/^(0|[1-9]\d*)$/.test(height)) return null;
	return Number(height);
}

export async function getL2DecoderHealth(opts?: {
	db?: Kysely<Database>;
	decoderName?: L2DecoderName;
	now?: Date;
}): Promise<L2DecoderHealth> {
	const db = opts?.db ?? getTargetDb();
	const decoderName = opts?.decoderName ?? FT_TRANSFER_DECODER_NAME;
	const eventType = L2_DECODER_EVENT_TYPES[decoderName];
	const now = opts?.now ?? new Date();

	const checkpoint = await db
		.selectFrom("l2_decoder_checkpoints")
		.select("last_cursor")
		.where("decoder_name", "=", decoderName)
		.executeTakeFirst();
	const checkpointBlockHeight = cursorBlockHeight(
		checkpoint?.last_cursor ?? null,
	);

	const tip = await db
		.selectFrom("blocks")
		.select(["height", "timestamp"])
		.where("canonical", "=", true)
		.orderBy("height", "desc")
		.limit(1)
		.executeTakeFirst();

	const latestDecoded = await db
		.selectFrom("decoded_events")
		.select(["created_at"])
		.where("event_type", "=", eventType)
		.where("canonical", "=", true)
		.orderBy("created_at", "desc")
		.limit(1)
		.executeTakeFirst();

	const checkpointBlock =
		checkpointBlockHeight === null
			? null
			: await db
					.selectFrom("blocks")
					.select(["height", "timestamp"])
					.where("height", "=", checkpointBlockHeight)
					.where("canonical", "=", true)
					.executeTakeFirst();

	const checkpointLagSeconds =
		tip && checkpointBlock
			? Math.max(0, Number(tip.timestamp) - Number(checkpointBlock.timestamp))
			: null;
	const lastDecodedAt = latestDecoded?.created_at ?? null;
	const writesRecent = lastDecodedAt
		? now.getTime() - lastDecodedAt.getTime() <= 5 * 60_000
		: false;
	const nearTip =
		checkpointLagSeconds !== null ? checkpointLagSeconds <= 60 : false;

	return {
		status: nearTip || writesRecent ? "healthy" : "unhealthy",
		decoder: decoderName,
		checkpoint: checkpoint?.last_cursor ?? null,
		checkpoint_block_height: checkpointBlockHeight,
		tip_block_height: tip ? Number(tip.height) : null,
		lag_seconds: checkpointLagSeconds,
		last_decoded_at: lastDecodedAt?.toISOString() ?? null,
		writes_recent: writesRecent,
	};
}

export async function getL2DecodersHealth(opts?: {
	db?: Kysely<Database>;
	decoderNames?: readonly L2DecoderName[];
	now?: Date;
}): Promise<L2DecodersHealth> {
	const decoderNames = opts?.decoderNames ?? L2_DECODER_NAMES;
	const decoders = await Promise.all(
		decoderNames.map((decoderName) =>
			getL2DecoderHealth({ db: opts?.db, decoderName, now: opts?.now }),
		),
	);

	return {
		status: decoders.every((decoder) => decoder.status === "healthy")
			? "healthy"
			: "unhealthy",
		decoders,
	};
}
