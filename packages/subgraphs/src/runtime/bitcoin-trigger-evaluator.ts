import type { RuneApplyEnvelope } from "@secondlayer/shared";
import { getErrorMessage } from "@secondlayer/shared";
import type {
	Database,
	InsertWebhookOutbox,
	Webhook,
} from "@secondlayer/shared/db";
import { getTargetDb } from "@secondlayer/shared/db";
import { listActiveChainWebhooks } from "@secondlayer/shared/db/queries/webhooks";
import {
	type IndexHttpClient,
	createInternalIndexHttpClient,
} from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";
import type { ChainTrigger } from "@secondlayer/shared/schemas/webhooks";
import { RUNE_EVENT_TYPES } from "@secondlayer/shared/streams-rows";
import type {
	RuneEventType,
	RuneStreamsEvent,
} from "@secondlayer/shared/streams-rows";
import type { Kysely } from "kysely";
import { getChainReorgGeneration } from "./trigger-evaluator-loop.ts";

/**
 * The Bitcoin (Runes) chain-trigger evaluator (plan 060) — a SECOND, separate
 * evaluator loop alongside the Stacks one in `trigger-evaluator-loop.ts`. Same
 * leader lock (`webhook-leader.ts` starts both under one election) and the
 * same forward-only, fast-forward-to-tip posture, but its own clock: it reads
 * `chain=bitcoin` Streams events (plan 059's Runes feed) instead of Stacks
 * blocks, and advances its own `bitcoin_last_cursor` column rather than
 * `last_processed_block`.
 *
 * Unlike the Stacks evaluator, there's no block/tx reconstruction here — a
 * `RuneStreamsEvent` row already carries everything a Runes trigger needs
 * (`rune_id`, `payload.address`, `payload.amount`), so matching happens
 * directly against the wire row. No long-poll either (Bitcoin blocks are
 * ~10 minutes apart; a plain 15s tick is more than fast enough and Streams'
 * `chain=bitcoin` tip has no `wait` support — see the plan's Refresh note).
 */

const BITCOIN_TRIGGER_POLL_MS =
	Number(process.env.BITCOIN_TRIGGER_POLL_MS) || 15_000;

const RUNE_TRIGGER_TYPE_SET = new Set<string>(RUNE_EVENT_TYPES);

function isRuneTriggerType(type: string): type is RuneEventType {
	return RUNE_TRIGGER_TYPE_SET.has(type);
}

/** A webhook's rune triggers only, paired with their index for traceability. */
function runeTriggersOf(sub: Webhook): ChainTrigger[] {
	const triggers = (sub.triggers ?? []) as ChainTrigger[];
	return triggers.filter((trigger) => isRuneTriggerType(trigger.type));
}

function hasRuneTrigger(sub: Webhook): boolean {
	return runeTriggersOf(sub).length > 0;
}

/** Every active chain webhook with at least one Runes trigger — the input to
 *  this evaluator (a webhook with only Stacks triggers is invisible here). */
export function runeSubsOf(chainSubs: Webhook[]): Webhook[] {
	return chainSubs.filter(hasRuneTrigger);
}

/** The Streams `types=` filter narrowing the fetch to just the event kinds
 *  these webhooks' triggers reference. */
export function referencedRuneEventTypes(runeSubs: Webhook[]): RuneEventType[] {
	const types = new Set<RuneEventType>();
	for (const sub of runeSubs) {
		for (const trigger of runeTriggersOf(sub)) {
			types.add(trigger.type as RuneEventType);
		}
	}
	return [...types];
}

/**
 * Does `trigger` match `event`? `rune` (normalized to a canonical `rune_id`
 * at webhook-create time, see `../../../api/src/routes/webhooks.ts`) is a
 * straight string compare against the event's own `rune_id` — no lookup at
 * match time. `rune_transfer` additionally supports `address` (the output's
 * mainnet address) and `minAmount` (inclusive, u128 — BigInt, never `Number()`).
 */
export function matchRuneTrigger(
	trigger: ChainTrigger,
	event: RuneStreamsEvent,
): boolean {
	if (trigger.type !== event.event_type) return false;
	const rune = (trigger as { rune?: string }).rune;
	if (rune !== undefined && rune !== event.rune_id) return false;
	if (trigger.type === "rune_transfer") {
		if (
			trigger.address !== undefined &&
			event.payload.address !== trigger.address
		) {
			return false;
		}
		if (trigger.minAmount !== undefined) {
			const min = BigInt(trigger.minAmount);
			const amount = BigInt(event.payload.amount);
			if (amount < min) return false;
		}
	}
	return true;
}

/** Stable dedup identity for a Runes delivery — (webhook, tx, event, block
 *  hash), namespaced `btc:` so it can never collide with a Stacks
 *  `chain:`-prefixed dedup key even at an overlapping numeric height. */
function runeDedupKey(webhookId: string, event: RuneStreamsEvent): string {
	return `btc:${webhookId}:${event.tx_id}:${event.event_index}:${event.block_hash}`;
}

function runeApplyRow(
	sub: Webhook,
	event: RuneStreamsEvent,
): InsertWebhookOutbox {
	const payload: RuneApplyEnvelope = {
		action: "apply",
		chain: "bitcoin",
		block_hash: event.block_hash,
		block_height: event.block_height,
		tx_id: event.tx_id,
		event_index: event.event_index,
		trigger: event.event_type,
		rune_id: event.rune_id,
		event: event.payload,
	};
	return {
		webhook_id: sub.id,
		kind: "chain",
		subgraph_name: null,
		table_name: null,
		block_height: event.block_height,
		tx_id: event.tx_id,
		row_pk: { tx_id: event.tx_id, event_index: event.event_index },
		event_type: `chain.${event.event_type}.apply`,
		payload,
		dedup_key: runeDedupKey(sub.id, event),
		// Bitcoin Streams events carry no wall-clock timestamp (see
		// `RuneStreamsEvent`'s doc in `streams-rows/events.ts`) — write null
		// rather than a synthesized one.
	};
}

/**
 * Match a page of Runes events against every active Runes trigger and write
 * apply-envelope rows. `(webhook_id, dedup_key)` makes re-processing a page
 * idempotent, same as the Stacks path.
 */
export async function emitRuneOutbox(
	db: Kysely<Database>,
	events: RuneStreamsEvent[],
	runeSubs: Webhook[],
): Promise<number> {
	if (events.length === 0 || runeSubs.length === 0) return 0;
	const rows: InsertWebhookOutbox[] = [];
	for (const event of events) {
		for (const sub of runeSubs) {
			for (const trigger of runeTriggersOf(sub)) {
				if (matchRuneTrigger(trigger, event)) {
					rows.push(runeApplyRow(sub, event));
					// A webhook's own triggers may overlap (e.g. two rune_transfer
					// triggers on the same rune) — only one apply per (webhook, event).
					break;
				}
			}
		}
	}
	if (rows.length === 0) return 0;
	const result = await db
		.insertInto("webhook_outbox")
		.values(rows)
		.onConflict((oc) => oc.columns(["webhook_id", "dedup_key"]).doNothing())
		.executeTakeFirst();
	return Number(result.numInsertedOrUpdatedRows ?? 0);
}

// ── Cursor (`trigger_evaluator_state.bitcoin_last_cursor`) ─────────────────

async function readBitcoinCursor(db: Kysely<Database>): Promise<string | null> {
	const row = await db
		.selectFrom("trigger_evaluator_state")
		.select("bitcoin_last_cursor")
		.where("id", "=", true)
		.executeTakeFirst();
	return row?.bitcoin_last_cursor ?? null;
}

function parseCursorParts(cursor: string): [number, number] {
	const [height, eventIndex] = cursor.split(":");
	return [Number(height), Number(eventIndex ?? 0)];
}

function cursorLess(a: string, b: string): boolean {
	const [ah, ai] = parseCursorParts(a);
	const [bh, bi] = parseCursorParts(b);
	if (ah !== bh) return ah < bh;
	return ai < bi;
}

/** Sentinel cursor meaning "past every event at `height`" — the same
 *  block-end sentinel `readStreamsBitcoinEvents` uses when a filtered range
 *  needs to advance past its last row. Used to fast-forward a fresh (or
 *  webhook-less) cursor straight to tip without processing anything. */
function tipCursor(height: number): string {
	return `${height}:2147483647`;
}

/**
 * Advance `bitcoin_last_cursor` to `to`, never backwards. Shares the SAME
 * in-process generation counter as the Stacks evaluator's `advanceCursor`
 * (`chainReorgGeneration` in `trigger-evaluator-loop.ts`) — both run under one
 * leader, and a reorg on EITHER chain must invalidate an in-flight advance on
 * both, since `handleChainReorg` rewinds a column on this same row.
 */
export async function advanceBitcoinCursor(
	db: Kysely<Database>,
	to: string,
	generation: number,
): Promise<{ advanced: boolean; reorged: boolean }> {
	return db.transaction().execute(async (trx) => {
		const cur = await trx
			.selectFrom("trigger_evaluator_state")
			.select("bitcoin_last_cursor")
			.where("id", "=", true)
			.forUpdate()
			.executeTakeFirst();
		if (getChainReorgGeneration() !== generation) {
			return { advanced: false, reorged: true };
		}
		const curVal = cur?.bitcoin_last_cursor ?? null;
		if (curVal === null || cursorLess(curVal, to)) {
			await trx
				.updateTable("trigger_evaluator_state")
				.set({ bitcoin_last_cursor: to, updated_at: new Date() })
				.where("id", "=", true)
				.execute();
			return { advanced: true, reorged: false };
		}
		return { advanced: false, reorged: false };
	});
}

// ── Source seam (HTTP in prod, a stub in tests) ────────────────────────────

export interface BitcoinStreamsSource {
	/** Current `chain=bitcoin` Streams tip height. */
	getTip(): Promise<number>;
	/** One page of events strictly after `afterCursor`, up to `toHeight`,
	 *  narrowed to `types`. Does NOT drain — the caller pages by feeding back
	 *  `nextCursor` on the following tick. */
	loadEvents(
		afterCursor: string,
		toHeight: number,
		types: RuneEventType[],
	): Promise<{ events: RuneStreamsEvent[]; nextCursor: string | null }>;
}

export function buildBitcoinStreamsSource(
	httpClient: IndexHttpClient = createInternalIndexHttpClient(),
): BitcoinStreamsSource {
	return {
		getTip: () => httpClient.getBitcoinStreamsTip(),
		async loadEvents(afterCursor, toHeight, types) {
			const page = await httpClient.getBitcoinStreamsEventsPage({
				types,
				toHeight,
				afterCursor,
			});
			return { events: page.events, nextCursor: page.next_cursor };
		},
	};
}

// ── One tick ────────────────────────────────────────────────────────────────

export type BitcoinEvaluatorTickResult = {
	emitted: number;
	advanced: boolean;
};

/**
 * One catch-up pass for Runes webhooks. Forward-looking by design, same as
 * the Stacks evaluator: an uninitialized cursor or zero Runes webhooks fast-
 * forwards straight to tip and emits nothing, so a freshly-created webhook
 * never backfills history. Extracted from the timer loop for testing.
 */
export async function runBitcoinEvaluatorOnce(
	db: Kysely<Database> = getTargetDb(),
	source: BitcoinStreamsSource = buildBitcoinStreamsSource(),
): Promise<BitcoinEvaluatorTickResult> {
	// Snapshot before any await — mirrors the Stacks evaluator (see its own
	// comment in `runEvaluatorOnce`).
	const generation = getChainReorgGeneration();
	const chainSubs = await listActiveChainWebhooks(db);
	const runeSubs = runeSubsOf(chainSubs);

	const tip = await source.getTip();
	if (tip <= 0) return { emitted: 0, advanced: false };

	const cursor = await readBitcoinCursor(db);
	if (cursor === null || runeSubs.length === 0) {
		const res = await advanceBitcoinCursor(db, tipCursor(tip), generation);
		return { emitted: 0, advanced: res.advanced };
	}

	const types = referencedRuneEventTypes(runeSubs);
	const page = await source.loadEvents(cursor, tip, types);
	const emitted =
		page.events.length > 0
			? await emitRuneOutbox(db, page.events, runeSubs)
			: 0;

	if (page.nextCursor && page.nextCursor !== cursor) {
		const res = await advanceBitcoinCursor(db, page.nextCursor, generation);
		return { emitted, advanced: res.advanced };
	}
	return { emitted, advanced: false };
}

/** Start the Bitcoin evaluator timer loop. Returns a stop function. Runs
 *  under the SAME leader lock as the Stacks evaluator (`webhook-leader.ts`
 *  starts both together) — see this module's doc. */
export function startBitcoinTriggerEvaluator(): () => void {
	let running = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const source = buildBitcoinStreamsSource();

	const tick = async (): Promise<void> => {
		if (!running) return;
		try {
			const result = await runBitcoinEvaluatorOnce(undefined, source);
			if (result.emitted > 0) {
				logger.info("Bitcoin trigger evaluator emitted rune deliveries", {
					count: result.emitted,
				});
			}
		} catch (err) {
			logger.error("Bitcoin trigger evaluator tick failed", {
				error: getErrorMessage(err),
			});
		}
		if (running) timer = setTimeout(tick, BITCOIN_TRIGGER_POLL_MS);
	};

	timer = setTimeout(tick, BITCOIN_TRIGGER_POLL_MS);
	logger.info("Bitcoin trigger evaluator started", {
		pollMs: BITCOIN_TRIGGER_POLL_MS,
	});
	return () => {
		running = false;
		if (timer) clearTimeout(timer);
	};
}
