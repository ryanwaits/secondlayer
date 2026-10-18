import { createHash } from "node:crypto";
import { type Database, getTargetDb } from "@secondlayer/shared/db";
import type { Webhook } from "@secondlayer/shared/db";
import {
	beginReplay,
	failScan,
	finishScan,
} from "@secondlayer/shared/db/queries/webhook-replays";
import { getWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { getErrorMessage } from "@secondlayer/shared/errors";
import { logger } from "@secondlayer/shared/logger";
import type { Kysely } from "kysely";
import {
	type BlockSource,
	PublicApiBlockSource,
	buildHttpClient,
} from "./block-source.ts";
import { chainDataReader } from "./chain-data-reader.ts";
import {
	blockTimeOf,
	buildSourcesMap,
	buildTraitContracts,
	emitChainOutbox,
	emitSbtcOutbox,
	evaluateBlock,
	loadSbtcEventsForRange,
	referencedEventTypes,
} from "./trigger-evaluator.ts";

/**
 * Replay a historical block range as new outbox entries for a single
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

/** Thrown by {@link replayWebhook} when a replay is still scanning for the
 *  webhook. The database enforces it (a partial unique index on
 *  `webhook_replays`), so it holds across API processes and restarts. */
export { ReplayInProgressError } from "@secondlayer/shared/db/queries/webhook-replays";

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

/** How many events a replay scanned and enqueued. */
export interface ReplayResult {
	replayId: string;
	enqueuedCount: number;
	scannedCount: number;
}

export async function replayWebhook(
	input: ReplayInput,
	opts?: { source?: BlockSource },
): Promise<ReplayResult> {
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

	const replayId = deterministicReplayId(
		sub.id,
		input.fromBlock,
		input.toBlock,
		input.replayIdSuffix,
	);
	await beginReplay(db, {
		id: replayId,
		webhookId: sub.id,
		fromBlock: input.fromBlock,
		toBlock: input.toBlock,
	});
	try {
		const result = await replayChainWebhook(db, sub, input, opts);
		await finishScan(db, replayId, {
			scanned: result.scannedCount,
			enqueued: result.enqueuedCount,
		});
		return result;
	} catch (err) {
		await failScan(db, replayId, getErrorMessage(err));
		throw err;
	}
}

const CHAIN_REPLAY_BATCH = 200;

/**
 * Replay a webhook by re-running the pure matcher over a historical
 * canonical block range and emitting fresh apply rows. The matcher is
 * range-driven, so we reload canonical blocks off the public Index/Streams
 * clock and re-match.
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
	// sBTC + trait reads: this stack's tables, or hosted Index on a tenant.
	const reader = chainDataReader();

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
		const traitContracts = await buildTraitContracts([sub], to, { reader });
		const sbtcByHeight = await loadSbtcEventsForRange([sub], from, to, {
			reader,
		});
		for (let h = from; h <= to; h++) {
			const bd = blocks.get(h);
			if (!bd) continue;
			scanned++;
			const blockTime = blockTimeOf(bd.block);
			const matches = evaluateBlock(bd, sources, traitContracts);
			if (matches.length > 0) {
				enqueued += await emitChainOutbox(
					db,
					matches,
					keyMeta,
					h,
					bd.block.hash,
					blockTime,
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
			enqueued += await emitSbtcOutbox(db, [sub], h, bd.block.hash, blockTime, {
				replayId,
				rows: sbtcByHeight.get(h) ?? [],
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
