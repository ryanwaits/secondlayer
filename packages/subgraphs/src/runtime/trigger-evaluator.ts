import type {
	ChainApplyEnvelope,
	SbtcDepositEvent,
	SbtcWithdrawalEvent,
} from "@secondlayer/shared";
import type {
	Database,
	InsertSubscriptionOutbox,
	SbtcEventTopic,
	SbtcEventsTable,
	Subscription,
} from "@secondlayer/shared/db";
import { getSourceDb } from "@secondlayer/shared/db";
import { resolveTraitContractIds } from "@secondlayer/shared/db/queries/contracts";
import type { ChainTrigger } from "@secondlayer/shared/schemas/subscriptions";
import type { Kysely, Selectable } from "kysely";
import type { SubgraphFilter } from "../types.ts";
import type { BlockData } from "./batch-loader.ts";
import { indexEventTypesForFilterTypes } from "./block-source.ts";
import {
	type MatchedTx,
	type TraitContracts,
	matchSources,
} from "./source-matcher.ts";

/** Trigger types that match a whole transaction (not an individual event). */
const TX_LEVEL_TRIGGER_TYPES = new Set(["contract_call", "contract_deploy"]);

/**
 * sBTC trigger types — matched via the `sbtc_events` table, NOT via
 * `decoded_events`. Excluded from the chain-event sources map so the
 * `matchSources` engine never sees them; `emitSbtcOutbox` handles them
 * with a dedicated query + match loop.
 */
const SBTC_TRIGGER_TYPES = new Set([
	"sbtc_deposit",
	"sbtc_withdrawal_create",
	"sbtc_withdrawal_accept",
	"sbtc_withdrawal_reject",
]);

function isSbtcTriggerType(type: string): boolean {
	return SBTC_TRIGGER_TYPES.has(type);
}

const SBTC_TRIGGER_TO_TOPIC: Record<string, SbtcEventTopic> = {
	sbtc_deposit: "completed-deposit",
	sbtc_withdrawal_create: "withdrawal-create",
	sbtc_withdrawal_accept: "withdrawal-accept",
	sbtc_withdrawal_reject: "withdrawal-reject",
};

/**
 * Pure matching core for direct chain-level subscriptions. A single evaluator
 * loop serves ALL chain subscriptions: it reads canonical blocks off the public
 * Index/Streams clock (via `PublicApiBlockSource`), runs the same
 * `matchSources` engine the subgraph runtime uses, and routes matches back to
 * the originating subscription. Everything here is pure/sync (DB only for trait
 * resolution) so it's trivially testable.
 *
 * Source keys are `"{subscriptionId}#{triggerIndex}"` — `matchSources` echoes
 * the key as `MatchedTx.sourceName`, letting the emitter recover which
 * subscription (and which trigger) matched. `keyMeta` carries the readable
 * trigger type for the outbox `event_type` / payload.
 */

export interface TriggerKeyMeta {
	subscriptionId: string;
	triggerIndex: number;
	triggerType: ChainTrigger["type"];
}

export interface ChainSourcesMap {
	sources: Record<string, SubgraphFilter>;
	keyMeta: Map<string, TriggerKeyMeta>;
}

function sourceKey(subscriptionId: string, triggerIndex: number): string {
	return `${subscriptionId}#${triggerIndex}`;
}

function toAmount(v: string | number | undefined): bigint | undefined {
	return v === undefined ? undefined : BigInt(v);
}

/**
 * Convert a stored `ChainTrigger` (JSON; amounts as string/number) to the
 * runtime `SubgraphFilter` the matcher expects (amounts as bigint). Field names
 * are identical across the two shapes, so this is a copy plus amount coercion.
 */
export function chainTriggerToFilter(trigger: ChainTrigger): SubgraphFilter {
	const t = trigger as ChainTrigger & {
		minAmount?: string | number;
		maxAmount?: string | number;
	};
	// Spread copies all set keys; amounts (string|number) are then overwritten
	// with bigint where present. An absent optional amount isn't in the spread,
	// so there's nothing to strip.
	const filter = { ...trigger } as Record<string, unknown>;
	const minAmount = toAmount(t.minAmount);
	const maxAmount = toAmount(t.maxAmount);
	if (minAmount !== undefined) filter.minAmount = minAmount;
	if (maxAmount !== undefined) filter.maxAmount = maxAmount;
	return filter as unknown as SubgraphFilter;
}

function triggersOf(sub: Subscription): ChainTrigger[] {
	return (sub.triggers ?? []) as ChainTrigger[];
}

/** Build the `matchSources` input from every active chain subscription. */
export function buildSourcesMap(chainSubs: Subscription[]): ChainSourcesMap {
	const sources: Record<string, SubgraphFilter> = {};
	const keyMeta = new Map<string, TriggerKeyMeta>();
	for (const sub of chainSubs) {
		triggersOf(sub).forEach((trigger, triggerIndex) => {
			// sBTC triggers are handled by emitSbtcOutbox — skip them here so
			// matchSources never tries to find sbtc_events in decoded_events.
			if (isSbtcTriggerType(trigger.type)) return;
			const key = sourceKey(sub.id, triggerIndex);
			sources[key] = chainTriggerToFilter(trigger);
			keyMeta.set(key, {
				subscriptionId: sub.id,
				triggerIndex,
				triggerType: trigger.type,
			});
		});
	}
	return { sources, keyMeta };
}

/** The Index event types the loader must fetch to satisfy all chain triggers. */
export function referencedEventTypes(chainSubs: Subscription[]): string[] {
	const filterTypes = new Set<string>();
	for (const sub of chainSubs) {
		for (const trigger of triggersOf(sub)) {
			// sBTC events live in sbtc_events, not in the Index event stream.
			if (!isSbtcTriggerType(trigger.type)) filterTypes.add(trigger.type);
		}
	}
	return indexEventTypesForFilterTypes([...filterTypes]);
}

/** Distinct traits referenced across all chain triggers. */
export function referencedTraits(chainSubs: Subscription[]): string[] {
	const traits = new Set<string>();
	for (const sub of chainSubs) {
		for (const trigger of triggersOf(sub)) {
			const trait = (trigger as { trait?: string }).trait;
			if (trait) traits.add(trait);
		}
	}
	return [...traits];
}

/**
 * Resolve each referenced trait to its conforming contract-id set as of
 * `asOfBlock`, from the contract registry (`CONTRACT_REGISTRY_ENABLED` populates
 * it). Empty map when no trigger is trait-scoped → no DB work. Membership only
 * grows, so the evaluator resolves this once per batch, not per block.
 */
export async function buildTraitContracts(
	db: Kysely<Database>,
	chainSubs: Subscription[],
	asOfBlock: number,
): Promise<TraitContracts> {
	const resolved: TraitContracts = new Map();
	for (const trait of referencedTraits(chainSubs)) {
		const ids = await resolveTraitContractIds(db, trait, asOfBlock);
		resolved.set(trait, new Set(ids));
	}
	return resolved;
}

/** Run the matcher for one block. Thin wrapper for symmetry/testability. */
export function evaluateBlock(
	block: BlockData,
	sources: Record<string, SubgraphFilter>,
	traitContracts: TraitContracts,
): MatchedTx[] {
	return matchSources(sources, block.txs, block.events, traitContracts);
}

// ── Outbox emission ─────────────────────────────────────────────────────────

// Apply-envelope shape is single-sourced as `ChainApplyEnvelope` in
// `@secondlayer/shared` (shared with the SDK consumer); reorg emits a matching
// `ChainReorgRollbackEnvelope`, see `handleChainReorg`.

/**
 * Stable dedup identity for a chain delivery — (subscription, tx, event,
 * block_hash). A tx-level match (contract_call/deploy) has no event, so
 * `eventIndex = -1`. `block_hash` is included so a tx that survives a reorg
 * (same tx_id, NEW canonical block) re-delivers an `apply` after its rollback,
 * instead of being suppressed forever; re-processing the SAME canonical block is
 * still idempotent (same hash → same key).
 */
function chainDedupKey(
	subscriptionId: string,
	txId: string,
	eventIndex: number,
	blockHash: string,
	replayId?: string,
): string {
	const base = `chain:${subscriptionId}:${txId}:${eventIndex}:${blockHash}`;
	// Replay keys are namespaced so a re-delivery doesn't collide with the
	// already-emitted live apply row (whose outbox entry may be long gone), while
	// re-running the SAME replay range stays idempotent (same replayId → same key).
	return replayId ? `replay:${replayId}:${base}` : base;
}

function applyRow(
	meta: TriggerKeyMeta,
	blockHeight: number,
	blockHash: string,
	txId: string,
	eventIndex: number,
	event: Record<string, unknown>,
	replayId?: string,
): InsertSubscriptionOutbox {
	const payload: ChainApplyEnvelope = {
		action: "apply",
		block_hash: blockHash,
		block_height: blockHeight,
		tx_id: txId,
		canonical: true,
		trigger: meta.triggerType,
		event,
	};
	return {
		subscription_id: meta.subscriptionId,
		kind: "chain",
		subgraph_name: null,
		table_name: null,
		block_height: blockHeight,
		tx_id: txId,
		row_pk: { tx_id: txId, event_index: eventIndex },
		event_type: `chain.${meta.triggerType}.apply`,
		payload,
		dedup_key: chainDedupKey(
			meta.subscriptionId,
			txId,
			eventIndex,
			blockHash,
			replayId,
		),
		...(replayId ? { is_replay: true } : {}),
	};
}

/**
 * Turn one block's matches into `subscription_outbox` rows (apply envelope). For
 * tx-level triggers (contract_call/deploy) we emit ONE row per matched tx
 * (`event_index = -1`); for event-level triggers, one row per matched event.
 * The `(subscription_id, dedup_key)` unique constraint makes re-processing a
 * block idempotent, so the emitter never double-delivers. Returns rows written.
 */
export async function emitChainOutbox(
	db: Kysely<Database>,
	matches: MatchedTx[],
	keyMeta: Map<string, TriggerKeyMeta>,
	blockHeight: number,
	blockHash: string,
	opts?: { replayId?: string },
): Promise<number> {
	const replayId = opts?.replayId;
	const rows: InsertSubscriptionOutbox[] = [];
	for (const match of matches) {
		const meta = keyMeta.get(match.sourceName);
		if (!meta) continue;
		const txId = match.tx.tx_id;
		if (TX_LEVEL_TRIGGER_TYPES.has(meta.triggerType)) {
			rows.push(
				applyRow(
					meta,
					blockHeight,
					blockHash,
					txId,
					-1,
					{
						tx_id: txId,
						type: match.tx.type,
						sender: match.tx.sender,
						status: match.tx.status,
						contract_id: match.tx.contract_id ?? null,
						function_name: match.tx.function_name ?? null,
						function_args: match.tx.function_args ?? null,
						result_hex: match.tx.raw_result ?? null,
					},
					replayId,
				),
			);
		} else {
			for (const event of match.events) {
				rows.push(
					applyRow(
						meta,
						blockHeight,
						blockHash,
						txId,
						event.event_index,
						{
							tx_id: txId,
							type: event.type,
							event_index: event.event_index,
							data: event.data,
						},
						replayId,
					),
				);
			}
		}
	}
	if (rows.length === 0) return 0;
	// Net-inserted (not built) so callers count genuinely new deliveries — a
	// re-processed block or a re-run replay returns 0.
	const result = await db
		.insertInto("subscription_outbox")
		.values(rows)
		.onConflict((oc) =>
			oc.columns(["subscription_id", "dedup_key"]).doNothing(),
		)
		.executeTakeFirst();
	return Number(result.numInsertedOrUpdatedRows ?? 0);
}

// ── sBTC event matching ──────────────────────────────────────────────────────

type SbtcRow = Selectable<SbtcEventsTable>;

async function loadSbtcEventsForBlock(
	db: Kysely<Database>,
	blockHeight: number,
	topics: SbtcEventTopic[],
): Promise<SbtcRow[]> {
	if (topics.length === 0) return [];
	return db
		.selectFrom("sbtc_events")
		.selectAll()
		.where("block_height", "=", blockHeight)
		.where("canonical", "=", true)
		.where("topic", "in", topics)
		.execute();
}

function toAmountBigInt(v: string | number | undefined): bigint | undefined {
	return v === undefined ? undefined : BigInt(v);
}

function matchSbtcTrigger(trigger: ChainTrigger, row: SbtcRow): boolean {
	const expectedTopic = SBTC_TRIGGER_TO_TOPIC[trigger.type];
	if (!expectedTopic || row.topic !== expectedTopic) return false;

	if (trigger.type === "sbtc_deposit") {
		if (trigger.sender && row.sender !== trigger.sender) return false;
		if (trigger.bitcoinTxid && row.bitcoin_txid !== trigger.bitcoinTxid)
			return false;
		if (trigger.requestId !== undefined && row.request_id !== trigger.requestId)
			return false;
		const min = toAmountBigInt(trigger.minAmount);
		const max = toAmountBigInt(trigger.maxAmount);
		if (min !== undefined || max !== undefined) {
			if (row.amount === null) return false;
			const amt = BigInt(row.amount);
			if (min !== undefined && amt < min) return false;
			if (max !== undefined && amt > max) return false;
		}
		return true;
	}

	if (trigger.type === "sbtc_withdrawal_create") {
		if (trigger.sender && row.sender !== trigger.sender) return false;
		if (trigger.requestId !== undefined && row.request_id !== trigger.requestId)
			return false;
		const min = toAmountBigInt(trigger.minAmount);
		const max = toAmountBigInt(trigger.maxAmount);
		if (min !== undefined || max !== undefined) {
			if (row.amount === null) return false;
			const amt = BigInt(row.amount);
			if (min !== undefined && amt < min) return false;
			if (max !== undefined && amt > max) return false;
		}
		return true;
	}

	if (trigger.type === "sbtc_withdrawal_accept") {
		if (trigger.requestId !== undefined && row.request_id !== trigger.requestId)
			return false;
		if (trigger.sweepTxid && row.sweep_txid !== trigger.sweepTxid) return false;
		return true;
	}

	if (trigger.type === "sbtc_withdrawal_reject") {
		if (trigger.requestId !== undefined && row.request_id !== trigger.requestId)
			return false;
		return true;
	}

	return false;
}

function buildSbtcEventPayload(
	triggerType: ChainTrigger["type"],
	row: SbtcRow,
): SbtcDepositEvent | SbtcWithdrawalEvent {
	if (triggerType === "sbtc_deposit") {
		return {
			topic: "completed-deposit",
			request_id: row.request_id ?? 0,
			sender: row.sender,
			amount: row.amount ?? "0",
			bitcoin_txid: row.bitcoin_txid,
			block_height: row.block_height,
			tx_id: row.tx_id,
		} satisfies SbtcDepositEvent;
	}
	return {
		topic: row.topic as
			| "withdrawal-create"
			| "withdrawal-accept"
			| "withdrawal-reject",
		request_id: row.request_id ?? 0,
		sender: row.sender,
		amount: row.amount,
		sweep_txid: row.sweep_txid,
		settlement_confirmed: false,
		block_height: row.block_height,
		tx_id: row.tx_id,
	} satisfies SbtcWithdrawalEvent;
}

/**
 * Match active sBTC chain subscriptions against `sbtc_events` for one block
 * and write apply-envelope rows to `subscription_outbox`. Runs alongside
 * `emitChainOutbox` (which handles decoded_events). Same dedup-key scheme —
 * re-processing the same block is idempotent.
 */
export async function emitSbtcOutbox(
	db: Kysely<Database>,
	chainSubs: Subscription[],
	blockHeight: number,
	blockHash: string,
	opts?: { replayId?: string; sourceDb?: Kysely<Database> },
): Promise<number> {
	const sbtcSubs = chainSubs.filter((sub) =>
		triggersOf(sub).some((t) => isSbtcTriggerType(t.type)),
	);
	if (sbtcSubs.length === 0) return 0;

	const neededTopics = new Set<SbtcEventTopic>();
	for (const sub of sbtcSubs) {
		for (const trigger of triggersOf(sub)) {
			const topic = SBTC_TRIGGER_TO_TOPIC[trigger.type];
			if (topic) neededTopics.add(topic);
		}
	}

	// `sbtc_events` is a SOURCE-plane table; the evaluator runs on the TARGET
	// handle (where an empty same-named table exists post-split). Read the decoded
	// rows from the source plane explicitly — reading off `db` here silently
	// matched zero rows under the live split, so sBTC webhooks never fired.
	const sbtcRows = await loadSbtcEventsForBlock(
		opts?.sourceDb ?? getSourceDb(),
		blockHeight,
		[...neededTopics],
	);
	if (sbtcRows.length === 0) return 0;

	const replayId = opts?.replayId;
	const outboxRows: InsertSubscriptionOutbox[] = [];

	for (const sub of sbtcSubs) {
		triggersOf(sub).forEach((trigger, triggerIndex) => {
			if (!isSbtcTriggerType(trigger.type)) return;
			const meta: TriggerKeyMeta = {
				subscriptionId: sub.id,
				triggerIndex,
				triggerType: trigger.type,
			};
			for (const row of sbtcRows) {
				if (!matchSbtcTrigger(trigger, row)) continue;
				const event = buildSbtcEventPayload(trigger.type, row);
				outboxRows.push(
					applyRow(
						meta,
						blockHeight,
						blockHash,
						row.tx_id,
						row.event_index,
						event as unknown as Record<string, unknown>,
						replayId,
					),
				);
			}
		});
	}

	if (outboxRows.length === 0) return 0;
	const result = await db
		.insertInto("subscription_outbox")
		.values(outboxRows)
		.onConflict((oc) =>
			oc.columns(["subscription_id", "dedup_key"]).doNothing(),
		)
		.executeTakeFirst();
	return Number(result.numInsertedOrUpdatedRows ?? 0);
}
