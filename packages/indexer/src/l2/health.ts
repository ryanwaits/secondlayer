import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";
import { BNS_DECODER_NAME } from "./bns-storage.ts";
import { POX4_DECODER_NAME } from "./pox4-storage.ts";
import { SBTC_DECODER_NAME, SBTC_TOKEN_DECODER_NAME } from "./sbtc-storage.ts";
import {
	FT_TRANSFER_DECODER_NAME,
	type L2DecoderName,
	L2_DECODER_EVENT_TYPES,
	getEnabledL2DecoderNames,
} from "./storage.ts";

export { getEnabledL2DecoderNames, L2_DECODER_EVENT_TYPES };
export type { L2DecoderName };

export type L2DecoderHealth = {
	status: "healthy" | "unhealthy";
	decoder: string;
	checkpoint: string | null;
	checkpoint_block_height: number | null;
	tip_block_height: number | null;
	lag_seconds: number | null;
	last_decoded_at: string | null;
	writes_recent: boolean;
	checkpoint_recent: boolean;
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
	decoderName?: string;
	now?: Date;
}): Promise<L2DecoderHealth> {
	const db = opts?.db ?? getSourceDb();
	const decoderName = opts?.decoderName ?? FT_TRANSFER_DECODER_NAME;
	const now = opts?.now ?? new Date();

	const checkpoint = await db
		.selectFrom("l2_decoder_checkpoints")
		.select(["last_cursor", "updated_at"])
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

	const latestDecoded = await readLatestDecodedAt({ db, decoderName });

	const checkpointBlock =
		checkpointBlockHeight === null
			? null
			: await db
					.selectFrom("blocks")
					.select(["height", "timestamp"])
					.where("height", "=", checkpointBlockHeight)
					.where("canonical", "=", true)
					.executeTakeFirst();

	// Guard against block rows with timestamp = 0 (historical bulk imports
	// occasionally produce these). Without the guard, lag_seconds = now - 0 ≈
	// 1.78B seconds (~56 years), poisoning every operational dashboard. Returning
	// `null` is the same shape used for "no checkpoint yet" — already a value
	// dashboards know how to handle.
	const checkpointLagSeconds =
		tip && checkpointBlock && Number(checkpointBlock.timestamp) > 0
			? Math.max(0, Number(tip.timestamp) - Number(checkpointBlock.timestamp))
			: null;
	const lastDecodedAt = latestDecoded?.created_at ?? null;
	const writesRecent = lastDecodedAt
		? now.getTime() - lastDecodedAt.getTime() <= 5 * 60_000
		: false;
	const checkpointRecent = checkpoint?.updated_at
		? now.getTime() - checkpoint.updated_at.getTime() <= 5 * 60_000
		: false;
	// 5-min `nearTip` window (was 60s): under the stricter AND-logic added in
	// the same patch as this constant, a 60s threshold flags any sparse decoder
	// that drifts more than a few blocks behind tip as unhealthy. 300s tolerates
	// normal block-time variance + sparse event arrival without masking truly
	// stuck decoders, which sit hours behind.
	const nearTip =
		checkpointLagSeconds !== null ? checkpointLagSeconds <= 300 : false;

	// `checkpointRecent` is a per-iteration heartbeat (`bumpDecoderCheckpoint`
	// in `service.ts` finally-block) — it only proves the process is alive, not
	// that it's making forward progress. A decoder stuck in an error-retry loop
	// keeps the heartbeat fresh while writing zero rows. Treat it as NECESSARY
	// (process must be alive), not sufficient — require a real-work signal too:
	// either we're close to tip (no work to do) or we wrote rows recently.
	return {
		status:
			checkpointRecent && (nearTip || writesRecent) ? "healthy" : "unhealthy",
		decoder: decoderName,
		checkpoint: checkpoint?.last_cursor ?? null,
		checkpoint_block_height: checkpointBlockHeight,
		tip_block_height: tip ? Number(tip.height) : null,
		lag_seconds: checkpointLagSeconds,
		last_decoded_at: lastDecodedAt?.toISOString() ?? null,
		writes_recent: writesRecent,
		checkpoint_recent: checkpointRecent,
	};
}

export async function getL2DecodersHealth(opts?: {
	db?: Kysely<Database>;
	decoderNames?: readonly string[];
	now?: Date;
}): Promise<L2DecodersHealth> {
	const decoderNames = opts?.decoderNames ?? getEnabledL2DecoderNames();
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

async function readLatestDecodedAt(opts: {
	db: Kysely<Database>;
	decoderName: string;
}): Promise<{ created_at: Date } | undefined> {
	if (opts.decoderName === SBTC_DECODER_NAME) {
		return opts.db
			.selectFrom("sbtc_events")
			.select(["created_at"])
			.where("canonical", "=", true)
			.orderBy("created_at", "desc")
			.limit(1)
			.executeTakeFirst();
	}
	if (opts.decoderName === SBTC_TOKEN_DECODER_NAME) {
		return opts.db
			.selectFrom("sbtc_token_events")
			.select(["created_at"])
			.where("canonical", "=", true)
			.orderBy("created_at", "desc")
			.limit(1)
			.executeTakeFirst();
	}
	if (opts.decoderName === POX4_DECODER_NAME) {
		return opts.db
			.selectFrom("pox4_calls")
			.select(["created_at"])
			.where("canonical", "=", true)
			.orderBy("created_at", "desc")
			.limit(1)
			.executeTakeFirst();
	}
	if (opts.decoderName === BNS_DECODER_NAME) {
		return opts.db
			.selectFrom("bns_name_events")
			.select(["created_at"])
			.where("canonical", "=", true)
			.orderBy("created_at", "desc")
			.limit(1)
			.executeTakeFirst();
	}
	const eventType =
		L2_DECODER_EVENT_TYPES[opts.decoderName as L2DecoderName] ??
		opts.decoderName;
	return opts.db
		.selectFrom("decoded_events")
		.select(["created_at"])
		.where("event_type", "=", eventType)
		.where("canonical", "=", true)
		.orderBy("created_at", "desc")
		.limit(1)
		.executeTakeFirst();
}
