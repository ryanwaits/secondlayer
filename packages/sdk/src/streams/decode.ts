import {
	optionalString,
	requireAmountField,
	requireHexValue,
	requireString,
} from "@secondlayer/shared/streams-rows";
import type { IndexEvent } from "../index-api/client.ts";
import type { StreamsEvent } from "./types.ts";

/**
 * Decode a raw Streams event into the SAME flat, `event_type`-discriminated
 * row shape Index serves — so Streams consumption reads identically to Index
 * consumption, with one call instead of eleven guard+decode pairs.
 *
 * ```ts
 * for (const event of envelope.events) {
 *   const row = decode(event);
 *   if (row.event_type === "ft_transfer") row.amount; // string, narrowed
 * }
 * ```
 *
 * Prefer `decoded: true` on `streams.events.consume` — then decoding never
 * appears in your code at all.
 */
export function decode(event: StreamsEvent): IndexEvent {
	const base = {
		cursor: event.cursor,
		block_height: event.block_height,
		block_time: event.ts,
		tx_id: event.tx_id,
		tx_index: event.tx_index,
		event_index: event.event_index,
		contract_id: event.contract_id,
	};
	// Payloads are validated field-by-field (never trusted casts): a malformed
	// payload throws with the event type and field named.
	const p = event.payload as Record<string, unknown>;
	switch (event.event_type) {
		case "stx_transfer":
			return {
				...base,
				event_type: "stx_transfer",
				sender: requireString(p, "sender", event.event_type),
				recipient: requireString(p, "recipient", event.event_type),
				amount: requireAmountField(p, "amount", event.event_type),
				memo: optionalString(p.memo),
			};
		case "stx_mint":
			return {
				...base,
				event_type: "stx_mint",
				recipient: requireString(p, "recipient", event.event_type),
				amount: requireAmountField(p, "amount", event.event_type),
			};
		case "stx_burn":
			return {
				...base,
				event_type: "stx_burn",
				sender: requireString(p, "sender", event.event_type),
				amount: requireAmountField(p, "amount", event.event_type),
			};
		case "stx_lock":
			return {
				...base,
				event_type: "stx_lock",
				sender: requireString(p, "locked_address", event.event_type),
				amount: requireAmountField(p, "locked_amount", event.event_type),
				payload: { unlock_height: optionalString(p.unlock_height) },
			};
		case "ft_transfer":
			return {
				...base,
				event_type: "ft_transfer",
				asset_identifier: requireString(
					p,
					"asset_identifier",
					event.event_type,
				),
				sender: requireString(p, "sender", event.event_type),
				recipient: requireString(p, "recipient", event.event_type),
				amount: requireAmountField(p, "amount", event.event_type),
			};
		case "ft_mint":
			return {
				...base,
				event_type: "ft_mint",
				asset_identifier: requireString(
					p,
					"asset_identifier",
					event.event_type,
				),
				recipient: requireString(p, "recipient", event.event_type),
				amount: requireAmountField(p, "amount", event.event_type),
			};
		case "ft_burn":
			return {
				...base,
				event_type: "ft_burn",
				asset_identifier: requireString(
					p,
					"asset_identifier",
					event.event_type,
				),
				sender: requireString(p, "sender", event.event_type),
				amount: requireAmountField(p, "amount", event.event_type),
			};
		case "nft_transfer":
			return {
				...base,
				event_type: "nft_transfer",
				asset_identifier: requireString(
					p,
					"asset_identifier",
					event.event_type,
				),
				sender: requireString(p, "sender", event.event_type),
				recipient: requireString(p, "recipient", event.event_type),
				value: requireHexValue(p, event.event_type),
			};
		case "nft_mint":
			return {
				...base,
				event_type: "nft_mint",
				asset_identifier: requireString(
					p,
					"asset_identifier",
					event.event_type,
				),
				recipient: requireString(p, "recipient", event.event_type),
				value: requireHexValue(p, event.event_type),
			};
		case "nft_burn":
			return {
				...base,
				event_type: "nft_burn",
				asset_identifier: requireString(
					p,
					"asset_identifier",
					event.event_type,
				),
				sender: requireString(p, "sender", event.event_type),
				value: requireHexValue(p, event.event_type),
			};
		case "print":
			return {
				...base,
				event_type: "print",
				payload: {
					topic: optionalString(p.topic),
					value: p.value,
					raw_value: optionalString(p.raw_value),
				},
			};
	}
}
