import type { ChainTrigger } from "../schemas/subscriptions.ts";

// Wire shapes delivered to a direct chain-event subscription's webhook. Canonical
// here so the producer (subgraphs trigger evaluator + reorg handler) and consumers
// (SDK webhook verify) share one definition and can't drift. The delivered body is
// the envelope; `event` is the matched chain event (decoded shape varies by trigger).

// ── sBTC typed event payloads ─────────────────────────────────────────────────

/**
 * Payload for `sbtc_deposit` (topic: completed-deposit).
 * `sender` is the Stacks address that initiated the deposit and receives the sBTC.
 */
export interface SbtcDepositEvent {
	topic: "completed-deposit";
	request_id: number;
	sender: string | null;
	amount: string;
	bitcoin_txid: string | null;
	block_height: number;
	tx_id: string;
}

/** Payload for `sbtc_withdrawal_create`, `sbtc_withdrawal_accept`, `sbtc_withdrawal_reject` —
 *  the on-Stacks lifecycle events. `settlement_confirmed` is always false here; the
 *  BTC L1 confirmation is delivered separately as `SbtcWithdrawalSweptConfirmedEvent`. */
export interface SbtcWithdrawalEvent {
	topic: "withdrawal-create" | "withdrawal-accept" | "withdrawal-reject";
	request_id: number;
	sender: string | null;
	amount: string | null;
	sweep_txid: string | null;
	settlement_confirmed: false;
	block_height: number;
	tx_id: string;
}

/** Payload for `sbtc_withdrawal_swept_confirmed` — fired once when a peg-out's
 *  committed BTC sweep crosses the confirmation threshold on Bitcoin. Anchored to
 *  the Stacks `withdrawal-accept` event (block_height/tx_id in the envelope); the
 *  Bitcoin-side specifics live here. */
export interface SbtcWithdrawalSweptConfirmedEvent {
	topic: "withdrawal-swept-confirmed";
	request_id: number;
	sweep_txid: string;
	btc_confirmations: number;
	btc_block_height: number | null;
	confirmed_at: string | null;
	amount: string | null;
	sender: string | null;
}

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
	event:
		| SbtcDepositEvent
		| SbtcWithdrawalEvent
		| SbtcWithdrawalSweptConfirmedEvent
		| Record<string, unknown>;
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
