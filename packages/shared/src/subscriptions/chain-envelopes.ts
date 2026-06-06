import type { ChainTrigger } from "../schemas/subscriptions.ts";

// Wire shapes delivered to a direct chain-event subscription's webhook. Canonical
// here so the producer (subgraphs trigger evaluator + reorg handler) and consumers
// (SDK webhook verify) share one definition and can't drift. The delivered body is
// the envelope; `event` is the matched chain event (decoded shape varies by trigger).

/**
 * Delivered when a matched chain event lands in a canonical block
 * (`event_type: "chain.<trigger>.apply"`). Tx-level triggers (contract_call /
 * contract_deploy) carry the tx as `event`; event-level triggers carry the event.
 */
export interface ChainApplyEnvelope {
	action: "apply";
	/** Canonical block hash this delivery is anchored to. */
	block_hash: string;
	block_height: number;
	tx_id: string;
	/** Always true — only canonical applies are delivered. */
	canonical: true;
	/** The chain-trigger type that matched. */
	trigger: ChainTrigger["type"];
	event: Record<string, unknown>;
}

/** One orphaned delivery recalled by a reorg rollback. */
export interface ChainReorgOrphanedEntry {
	tx_id: string | null;
	/** The event body from the original `apply` delivery. */
	event: unknown;
}

/**
 * Delivered once per affected subscription on a reorg
 * (`event_type: "chain.reorg.rollback"`). Lists the previously-delivered applies
 * at or above `fork_point_height` that are now orphaned, so the consumer can undo
 * them precisely. `orphaned` is capped (currently 500); `truncated` flags overflow.
 */
export interface ChainReorgRollbackEnvelope {
	action: "rollback";
	fork_point_height: number;
	orphaned: ChainReorgOrphanedEntry[];
	truncated: boolean;
}

/** Any chain-subscription webhook body. Discriminate on `action`. */
export type ChainWebhookEnvelope =
	| ChainApplyEnvelope
	| ChainReorgRollbackEnvelope;
