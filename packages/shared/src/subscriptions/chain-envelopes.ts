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

// ── Typed per-trigger delivery (`ChainWebhookDelivery`) ────────────────────
//
// `ChainApplyEnvelope.event` above is intentionally loose (`Record<string,
// unknown>` fallback) because the producer (`applyRow` in
// trigger-evaluator.ts) builds it generically for every trigger type from one
// code path. The types below reconstruct the SPECIFIC shape of `event`/`event.data`
// per trigger, straight from the code that builds it
// (`packages/subgraphs/src/runtime/reconstruct.ts` for event-level triggers,
// `trigger-evaluator.ts`'s `emitChainOutbox` for tx-level triggers), so a
// consumer can `switch` on `data.trigger` with full narrowing instead of
// re-deriving the shape from a live capture.
//
// Optional fields below (`sender?`, `recipient?`) are OMITTED from the wire
// body entirely when absent — `JSON.stringify` drops `undefined` values, so
// e.g. a `stx_mint` delivery has no `sender` key at all, not `sender: null`.

/** `event.data` for a `stx_transfer` delivery. */
export interface ChainStxTransferData {
	sender?: string;
	recipient?: string;
	amount: string;
	/** Always present; `""` when the transfer carried no memo. */
	memo: string;
}
/** `event.data` for a `stx_mint` delivery. */
export interface ChainStxMintData {
	recipient?: string;
	amount: string;
}
/** `event.data` for a `stx_burn` delivery. */
export interface ChainStxBurnData {
	sender?: string;
	amount: string;
}
/** `event.data` for a `stx_lock` delivery. */
export interface ChainStxLockData {
	locked_address: string;
	locked_amount: string;
	unlock_height: string | null;
}
/** `event.data` for an `ft_transfer` delivery. */
export interface ChainFtTransferData {
	asset_identifier: string;
	sender?: string;
	recipient?: string;
	amount: string;
}
/** `event.data` for an `ft_mint` delivery. */
export interface ChainFtMintData {
	asset_identifier: string;
	recipient?: string;
	amount: string;
}
/** `event.data` for an `ft_burn` delivery. */
export interface ChainFtBurnData {
	asset_identifier: string;
	sender?: string;
	amount: string;
}
/**
 * `event.data` for an `nft_transfer` delivery. Unlike Streams' `NftTransferPayload`,
 * there is no decoded `value` field — only the canonical hex of the token-id
 * Clarity value (`raw_value`).
 */
export interface ChainNftTransferData {
	asset_identifier: string;
	sender?: string;
	recipient?: string;
	raw_value: string;
}
/** `event.data` for an `nft_mint` delivery. See {@link ChainNftTransferData}. */
export interface ChainNftMintData {
	asset_identifier: string;
	recipient?: string;
	raw_value: string;
}
/** `event.data` for an `nft_burn` delivery. See {@link ChainNftTransferData}. */
export interface ChainNftBurnData {
	asset_identifier: string;
	sender?: string;
	raw_value: string;
}
/**
 * `event.data` for a `print_event` delivery. Note the field is
 * `contract_identifier` — Streams' `PrintPayload` uses `contract_id` for the
 * same contract, which is NOT the field name delivered here.
 */
export interface ChainPrintEventData {
	topic: string | null;
	contract_identifier: string;
	value: unknown;
	raw_value: string | null;
}

/**
 * Wrapper around an event-level trigger's matched event. `type` is the node's
 * suffixed event-kind (`"stx_transfer_event"`, `"ft_mint_event"`, …) — EXCEPT
 * `print_event` triggers, whose `event.type` is `"contract_event"` (the node's
 * raw name for a print event), not `"print_event_event"`.
 */
export interface ChainEventEnvelope<TType extends string, TData> {
	tx_id: string;
	type: TType;
	event_index: number;
	data: TData;
}

/**
 * A tx-level trigger's matched event (`contract_call` / `contract_deploy`) —
 * flat, no nested `data` key. `function_args` are RAW (undecoded) Clarity-value
 * hex strings in call order, not decoded values.
 */
export interface ChainTxLevelEvent {
	tx_id: string;
	/** Stacks tx type, e.g. `"contract_call"` for a `contract_call` trigger or
	 *  `"smart_contract"` for a `contract_deploy` trigger — NOT `"contract_deploy"`. */
	type: string;
	sender: string;
	status: string;
	contract_id: string | null;
	function_name: string | null;
	/** Raw (undecoded) Clarity-value hex strings, in call order. */
	function_args: string[] | null;
	/** Raw hex of the tx's Clarity return value. */
	result_hex: string | null;
}

/** One `apply` envelope, generic over its trigger literal + matched-event shape. */
export interface ChainApplyEnvelopeOf<
	TTrigger extends ChainTrigger["type"],
	TEvent,
> {
	action: "apply";
	block_hash: string;
	block_height: number;
	tx_id: string;
	canonical: true;
	trigger: TTrigger;
	event: TEvent;
}

type ChainApplyDeliveryOf<TTrigger extends ChainTrigger["type"], TEvent> = {
	type: `chain.${TTrigger}.apply`;
	timestamp: string;
	data: ChainApplyEnvelopeOf<TTrigger, TEvent>;
};

/** Delivered once per affected subscription on a reorg (`type: "chain.reorg.rollback"`). */
export interface ChainReorgRollbackDelivery {
	type: "chain.reorg.rollback";
	timestamp: string;
	data: ChainReorgRollbackEnvelope;
}

/** The `POST /subscriptions/:id/test` ping (`type: "chain.test.apply"`) — not a real chain event. */
export interface ChainTestDelivery {
	type: "chain.test.apply";
	timestamp: string;
	data: {
		test: true;
		message: string;
		subscription_id: string;
		sent_at: string;
	};
}

/**
 * The full wire body of a chain-subscription webhook delivery, as sent to a
 * `format: "standard-webhooks"` subscription (the default) — `{ type,
 * timestamp, data }`. Discriminate on `data.trigger` (or the top-level `type`)
 * to narrow `data.event`:
 *
 * ```ts
 * const delivery = decodeChainWebhook(rawBody);
 * if (delivery.data.action === "apply") {
 *   switch (delivery.data.trigger) {
 *     case "stx_transfer":
 *       delivery.data.event.data.amount; // typed
 *       break;
 *     case "contract_call":
 *       delivery.data.event.function_name; // typed, flat (no nested `.data`)
 *       break;
 *   }
 * }
 * ```
 *
 * NOTE: this is the DELIVERED webhook body, not a Streams/Index event — those
 * have an unrelated `{ event_type, payload }` shape (see `StreamsEvent` in
 * `@secondlayer/sdk`). Do not parse a chain-subscription delivery as a Streams
 * event or vice versa — mixing them up is the exact bug this type exists to
 * prevent.
 *
 * Other subscription `format`s (`raw`, `cloudevents`, `inngest`, `trigger`,
 * `cloudflare`) carry the same `data` value (a `ChainApplyEnvelope` /
 * `ChainReorgRollbackEnvelope`) under a different outer envelope — see the
 * "Chain subscription webhook payloads" doc.
 */
export type ChainWebhookDelivery =
	| ChainApplyDeliveryOf<
			"stx_transfer",
			ChainEventEnvelope<"stx_transfer_event", ChainStxTransferData>
	  >
	| ChainApplyDeliveryOf<
			"stx_mint",
			ChainEventEnvelope<"stx_mint_event", ChainStxMintData>
	  >
	| ChainApplyDeliveryOf<
			"stx_burn",
			ChainEventEnvelope<"stx_burn_event", ChainStxBurnData>
	  >
	| ChainApplyDeliveryOf<
			"stx_lock",
			ChainEventEnvelope<"stx_lock_event", ChainStxLockData>
	  >
	| ChainApplyDeliveryOf<
			"ft_transfer",
			ChainEventEnvelope<"ft_transfer_event", ChainFtTransferData>
	  >
	| ChainApplyDeliveryOf<
			"ft_mint",
			ChainEventEnvelope<"ft_mint_event", ChainFtMintData>
	  >
	| ChainApplyDeliveryOf<
			"ft_burn",
			ChainEventEnvelope<"ft_burn_event", ChainFtBurnData>
	  >
	| ChainApplyDeliveryOf<
			"nft_transfer",
			ChainEventEnvelope<"nft_transfer_event", ChainNftTransferData>
	  >
	| ChainApplyDeliveryOf<
			"nft_mint",
			ChainEventEnvelope<"nft_mint_event", ChainNftMintData>
	  >
	| ChainApplyDeliveryOf<
			"nft_burn",
			ChainEventEnvelope<"nft_burn_event", ChainNftBurnData>
	  >
	| ChainApplyDeliveryOf<
			"print_event",
			ChainEventEnvelope<"contract_event", ChainPrintEventData>
	  >
	| ChainApplyDeliveryOf<"contract_call", ChainTxLevelEvent>
	| ChainApplyDeliveryOf<"contract_deploy", ChainTxLevelEvent>
	| ChainApplyDeliveryOf<"sbtc_deposit", SbtcDepositEvent>
	| ChainApplyDeliveryOf<"sbtc_withdrawal_create", SbtcWithdrawalEvent>
	| ChainApplyDeliveryOf<"sbtc_withdrawal_accept", SbtcWithdrawalEvent>
	| ChainApplyDeliveryOf<"sbtc_withdrawal_reject", SbtcWithdrawalEvent>
	| ChainApplyDeliveryOf<
			"sbtc_withdrawal_swept_confirmed",
			SbtcWithdrawalSweptConfirmedEvent
	  >
	| ChainReorgRollbackDelivery
	| ChainTestDelivery;
