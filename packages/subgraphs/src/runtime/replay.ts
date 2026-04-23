import { createHash } from "node:crypto";
import { type Database, getTargetDb } from "@secondlayer/shared/db";
import { getSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, sql } from "kysely";
import { pgSchemaName as defaultSchemaName } from "../schema/utils.ts";

/**
 * Replay historical subgraph rows as new outbox entries for a single
 * subscription. Rows are marked `is_replay=TRUE` so the emitter can
 * prioritize live deliveries (90/10 split) and the delivery log can
 * tag replays distinctly.
 *
 * Idempotency: `replayId` is deterministic over `(subscription_id,
 * fromBlock, toBlock)`, so re-running the same replay range is a no-op
 * thanks to the unique `(subscription_id, dedup_key)` constraint. A
 * user who actually wants to re-deliver the same range passes a
 * distinct `replayIdSuffix` (e.g. a timestamp) to get a fresh key.
 */

const BATCH_SIZE = 500;

function replayDedupKey(
	subgraphName: string,
	tableName: string,
	row: Record<string, unknown>,
	replayId: string,
): string {
	const canonical = `replay:${replayId}:${subgraphName}:${tableName}:${stableStringify(row)}`;
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function stableStringify(obj: Record<string, unknown>): string {
	const keys = Object.keys(obj).sort();
	return JSON.stringify(
		keys.reduce<Record<string, unknown>>((acc, k) => {
			acc[k] = obj[k];
			return acc;
		}, {}),
	);
}

export interface ReplayInput {
	accountId: string;
	subscriptionId: string;
	fromBlock: number;
	toBlock: number;
	/** Force re-delivery by appending a unique suffix to the replay id. */
	replayIdSuffix?: string;
}

function deterministicReplayId(
	subscriptionId: string,
	fromBlock: number,
	toBlock: number,
	suffix?: string,
): string {
	const canonical = `${subscriptionId}:${fromBlock}:${toBlock}${suffix ? `:${suffix}` : ""}`;
	return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export interface ReplayResult {
	replayId: string;
	enqueuedCount: number;
	scannedCount: number;
}

async function resolveSchemaName(
	db: Kysely<Database>,
	subgraphName: string,
): Promise<string> {
	const row = await db
		.selectFrom("subgraphs")
		.select("schema_name")
		.where("name", "=", subgraphName)
		.executeTakeFirst();
	if (!row) {
		throw new Error(
			`Subgraph "${subgraphName}" not registered — cannot replay its rows. Deploy the subgraph first.`,
		);
	}
	return row.schema_name ?? defaultSchemaName(subgraphName);
}

export async function replaySubscription(
	input: ReplayInput,
): Promise<ReplayResult> {
	if (input.fromBlock > input.toBlock) {
		throw new Error("fromBlock must be <= toBlock");
	}
	if (input.toBlock - input.fromBlock > 100_000) {
		throw new Error("replay range exceeds 100k blocks");
	}

	const db = getTargetDb();
	const sub = await getSubscription(db, input.accountId, input.subscriptionId);
	if (!sub) throw new Error("Subscription not found");

	const schema = await resolveSchemaName(db, sub.subgraph_name);
	const replayId = deterministicReplayId(
		sub.id,
		input.fromBlock,
		input.toBlock,
		input.replayIdSuffix,
	);

	let scanned = 0;
	let enqueued = 0;
	let offset = 0;

	while (true) {
		const { rows } = await sql<
			Record<string, unknown>
		>`SELECT * FROM ${sql.raw(`"${schema}"."${sub.table_name}"`)}
			WHERE _block_height >= ${sql.lit(input.fromBlock)}
				AND _block_height <= ${sql.lit(input.toBlock)}
			ORDER BY _block_height, _created_at
			LIMIT ${sql.lit(BATCH_SIZE)} OFFSET ${sql.lit(offset)}`.execute(db);

		if (rows.length === 0) break;
		scanned += rows.length;

		const inserts = rows.map((row) => ({
			subscription_id: sub.id,
			subgraph_name: sub.subgraph_name,
			table_name: sub.table_name,
			block_height: Number(row._block_height),
			tx_id: (row._tx_id as string | undefined) ?? null,
			row_pk: {
				blockHeight: Number(row._block_height),
				txId: row._tx_id ?? "",
				replayId,
			},
			event_type: `${sub.subgraph_name}.${sub.table_name}.replay`,
			payload: row,
			dedup_key: replayDedupKey(
				sub.subgraph_name,
				sub.table_name,
				row,
				replayId,
			),
			is_replay: true,
		}));

		const result = await db
			.insertInto("subscription_outbox")
			.values(inserts)
			.onConflict((oc) =>
				oc.columns(["subscription_id", "dedup_key"]).doNothing(),
			)
			.executeTakeFirst();
		enqueued += Number(result.numInsertedOrUpdatedRows ?? 0);

		if (rows.length < BATCH_SIZE) break;
		offset += BATCH_SIZE;
	}

	logger.info("Replay enqueued", {
		subscription: sub.name,
		replayId,
		scanned,
		enqueued,
		fromBlock: input.fromBlock,
		toBlock: input.toBlock,
	});

	return { replayId, enqueuedCount: enqueued, scannedCount: scanned };
}
