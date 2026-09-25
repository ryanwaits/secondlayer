import { createHash } from "node:crypto";
import { type Database, getTargetDb } from "@secondlayer/shared/db";
import type { Webhook } from "@secondlayer/shared/db";
import { getWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, sql } from "kysely";
import { pgSchemaName as defaultSchemaName } from "../schema/utils.ts";
import {
	type BlockSource,
	PublicApiBlockSource,
	buildHttpClient,
} from "./block-source.ts";
import {
	buildSourcesMap,
	buildTraitContracts,
	emitChainOutbox,
	emitSbtcOutbox,
	evaluateBlock,
	referencedEventTypes,
} from "./trigger-evaluator.ts";

/**
 * Replay historical subgraph rows as new outbox entries for a single
 * webhook. Rows are marked `is_replay=TRUE` so the emitter can
 * prioritize live deliveries (90/10 split) and the delivery log can
 * tag replays distinctly.
 *
 * Idempotency: `replayId` is deterministic over `(webhook_id,
 * fromBlock, toBlock)`, so re-running the same replay range is a no-op
 * thanks to the unique `(webhook_id, dedup_key)` constraint. A
 * user who actually wants to re-deliver the same range passes a
 * distinct `replayIdSuffix` (e.g. a timestamp) to get a fresh key.
 */

const BATCH_SIZE = 500;

/** Default cap on blocks per replay call — overridable via
 *  `WEBHOOK_REPLAY_MAX_BLOCKS` for an operator who wants a tighter (or, for a
 *  trusted self-host, looser) limit. Read live, not baked in at import. */
const WEBHOOK_REPLAY_MAX_BLOCKS_DEFAULT = 100_000;

function webhookReplayMaxBlocks(): number {
	const raw = process.env.WEBHOOK_REPLAY_MAX_BLOCKS;
	if (raw === undefined) return WEBHOOK_REPLAY_MAX_BLOCKS_DEFAULT;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: WEBHOOK_REPLAY_MAX_BLOCKS_DEFAULT;
}

/** Renders a block count the way the original hardcoded message did
 *  ("100k blocks") for round thousands, falling back to the raw number for a
 *  ceiling that isn't a clean multiple of 1000. */
function formatBlockCount(n: number): string {
	return n % 1000 === 0 ? `${n / 1000}k` : `${n}`;
}

/**
 * One in-flight replay per webhook at a time. Replay is a synchronous scan
 * (the route awaits it fully before responding), so two concurrent requests
 * for the same webhook would otherwise interleave their scans against the
 * same dedup keyspace. In-memory per-process — replay already isn't
 * horizontally coordinated (see `BATCH_SIZE` keyset pagination above), so
 * this matches its existing single-process assumption.
 */
const inFlightReplays = new Set<string>();

/** Thrown by {@link replayWebhook} when a replay is already running for the
 *  webhook. The route maps this to 409; `force` does not bypass it — a forced
 *  re-delivery still has to wait for the previous replay to finish. */
export class ReplayInProgressError extends Error {
	constructor() {
		super("replay already in progress for this webhook");
		this.name = "ReplayInProgressError";
	}
}

/**
 * Test-only seam: directly mark (or clear) a webhook as having an in-flight
 * replay. Two real concurrent `replayWebhook` calls race the same DB fetch,
 * so which one wins the guard isn't deterministic in a test; this lets a test
 * exercise the guard (and the route's 409 mapping) without that race.
 * Production code never calls this.
 */
export function __setReplayInFlightForTest(
	webhookId: string,
	inFlight: boolean,
): void {
	if (inFlight) inFlightReplays.add(webhookId);
	else inFlightReplays.delete(webhookId);
}

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
	webhookId: string;
	fromBlock: number;
	toBlock: number;
	/** Force re-delivery by appending a unique suffix to the replay id. */
	replayIdSuffix?: string;
}

function deterministicReplayId(
	webhookId: string,
	fromBlock: number,
	toBlock: number,
	suffix?: string,
): string {
	const canonical = `${webhookId}:${fromBlock}:${toBlock}${suffix ? `:${suffix}` : ""}`;
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

export async function replayWebhook(input: ReplayInput): Promise<ReplayResult> {
	if (input.fromBlock > input.toBlock) {
		throw new Error("fromBlock must be <= toBlock");
	}
	const maxBlocks = webhookReplayMaxBlocks();
	if (input.toBlock - input.fromBlock > maxBlocks) {
		throw new Error(
			`replay range exceeds ${formatBlockCount(maxBlocks)} blocks`,
		);
	}

	const db = getTargetDb();
	const sub = await getWebhook(db, input.accountId, input.webhookId);
	if (!sub) throw new Error("Webhook not found");

	if (inFlightReplays.has(sub.id)) {
		throw new ReplayInProgressError();
	}
	inFlightReplays.add(sub.id);
	try {
		// Chain subs have no processed table — they react to raw chain events.
		// Replay re-runs the pure matcher over the canonical block range instead
		// of scanning rows.
		if (sub.kind === "chain") {
			return await replayChainWebhook(db, sub, input);
		}

		const subgraphName = sub.subgraph_name;
		const tableName = sub.table_name;
		if (sub.kind !== "subgraph" || !subgraphName || !tableName) {
			throw new Error(
				"replay is only supported for subgraph or chain webhooks",
			);
		}

		const schema = await resolveSchemaName(db, subgraphName);
		const replayId = deterministicReplayId(
			sub.id,
			input.fromBlock,
			input.toBlock,
			input.replayIdSuffix,
		);

		let scanned = 0;
		let enqueued = 0;
		// Keyset pagination, not a positional skip-count: `_created_at` is written
		// as the literal NOW() (one value per transaction, so identical for every
		// row in a block), which makes (_block_height, _created_at) non-unique.
		// Paging by skip-count over a non-unique sort lets tied rows reorder
		// between pages and drop rows silently. `_id` is BIGSERIAL and total.
		let lastId = 0n;

		while (true) {
			const { rows } = await sql<
				Record<string, unknown>
			>`SELECT * FROM ${sql.raw(`"${schema}"."${tableName}"`)}
				WHERE _block_height >= ${sql.lit(input.fromBlock)}
					AND _block_height <= ${sql.lit(input.toBlock)}
					AND _id > ${sql.lit(lastId)}
				ORDER BY _id ASC
				LIMIT ${sql.lit(BATCH_SIZE)}`.execute(db);

			if (rows.length === 0) break;
			scanned += rows.length;

			const inserts = rows.map((row) => ({
				webhook_id: sub.id,
				subgraph_name: subgraphName,
				table_name: tableName,
				block_height: Number(row._block_height),
				tx_id: (row._tx_id as string | undefined) ?? null,
				row_pk: {
					blockHeight: Number(row._block_height),
					txId: row._tx_id ?? "",
					replayId,
				},
				event_type: `${subgraphName}.${tableName}.replay`,
				payload: row,
				dedup_key: replayDedupKey(subgraphName, tableName, row, replayId),
				is_replay: true,
			}));

			const result = await db
				.insertInto("webhook_outbox")
				.values(inserts)
				.onConflict((oc) => oc.columns(["webhook_id", "dedup_key"]).doNothing())
				.executeTakeFirst();
			enqueued += Number(result.numInsertedOrUpdatedRows ?? 0);

			lastId = BigInt(String(rows[rows.length - 1]?._id));
			if (rows.length < BATCH_SIZE) break;
		}

		logger.info("Replay enqueued", {
			webhook: sub.name,
			replayId,
			scanned,
			enqueued,
			fromBlock: input.fromBlock,
			toBlock: input.toBlock,
		});

		return { replayId, enqueuedCount: enqueued, scannedCount: scanned };
	} finally {
		inFlightReplays.delete(sub.id);
	}
}

const CHAIN_REPLAY_BATCH = 200;

/**
 * Replay a chain webhook by re-running the pure matcher over a historical
 * canonical block range and emitting fresh apply rows. Unlike subgraph replay
 * there is no processed table to scan — the matcher is range-driven, so we
 * reload canonical blocks off the public Index/Streams clock and re-match.
 *
 * Rows are emitted with `is_replay=TRUE` and replay-namespaced dedup keys, and —
 * critically — this never advances `trigger_evaluator_state`: replay is
 * historical and must not move the live forward cursor.
 */
export async function replayChainWebhook(
	db: Kysely<Database>,
	sub: Webhook,
	input: ReplayInput,
	opts?: { source?: BlockSource },
): Promise<ReplayResult> {
	const replayId = deterministicReplayId(
		sub.id,
		input.fromBlock,
		input.toBlock,
		input.replayIdSuffix,
	);

	const { sources, keyMeta } = buildSourcesMap([sub]);
	const source =
		opts?.source ??
		new PublicApiBlockSource(buildHttpClient(), referencedEventTypes([sub]));

	let scanned = 0;
	let enqueued = 0;
	for (
		let from = input.fromBlock;
		from <= input.toBlock;
		from += CHAIN_REPLAY_BATCH
	) {
		const to = Math.min(from + CHAIN_REPLAY_BATCH - 1, input.toBlock);
		const blocks = await source.loadBlockRange(from, to);
		// Trait membership only grows; resolve once per batch as of its top height.
		const traitContracts = await buildTraitContracts([sub], to);
		for (let h = from; h <= to; h++) {
			const bd = blocks.get(h);
			if (!bd) continue;
			scanned++;
			const matches = evaluateBlock(bd, sources, traitContracts);
			if (matches.length > 0) {
				enqueued += await emitChainOutbox(
					db,
					matches,
					keyMeta,
					h,
					bd.block.hash,
					{
						replayId,
					},
				);
			}
			// sBTC lifecycle triggers (deposit/withdrawal-create/accept/reject) match
			// against `sbtc_events`, not decoded_events — mirror the live loop so a
			// replay over a historical range backfills sBTC webhooks too. (Settlement
			// `swept_confirmed` is cursor/confirmed_at driven, not block-keyed, so it
			// emits nothing here — documented forward-only.)
			enqueued += await emitSbtcOutbox(db, [sub], h, bd.block.hash, {
				replayId,
			});
		}
	}

	logger.info("Chain replay enqueued", {
		webhook: sub.name,
		replayId,
		scanned,
		enqueued,
		fromBlock: input.fromBlock,
		toBlock: input.toBlock,
	});

	return { replayId, enqueuedCount: enqueued, scannedCount: scanned };
}
