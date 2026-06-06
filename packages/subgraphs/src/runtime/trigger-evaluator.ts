import type {
	Database,
	InsertSubscriptionOutbox,
	Subscription,
} from "@secondlayer/shared/db";
import { resolveTraitContractIds } from "@secondlayer/shared/db/queries/contracts";
import type { ChainApplyEnvelope } from "@secondlayer/shared";
import type { ChainTrigger } from "@secondlayer/shared/schemas/subscriptions";
import type { Kysely } from "kysely";
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
		for (const trigger of triggersOf(sub)) filterTypes.add(trigger.type);
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
