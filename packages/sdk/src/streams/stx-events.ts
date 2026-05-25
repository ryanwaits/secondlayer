import {
	decodedRow,
	optionalString,
	requireAmount,
	requireString,
} from "./_payload.ts";
import type { StreamsEvent } from "./types.ts";

export type DecodedStxTransferPayload = {
	sender: string;
	recipient: string;
	amount: string;
	memo: string | null;
};

export type DecodedStxTransfer = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "stx_transfer";
	decoded_payload: DecodedStxTransferPayload;
	source_cursor: string;
};

export type DecodedStxMintPayload = {
	recipient: string;
	amount: string;
};

export type DecodedStxMint = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "stx_mint";
	decoded_payload: DecodedStxMintPayload;
	source_cursor: string;
};

export type DecodedStxBurnPayload = {
	sender: string;
	amount: string;
};

export type DecodedStxBurn = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "stx_burn";
	decoded_payload: DecodedStxBurnPayload;
	source_cursor: string;
};

export function isStxTransfer(
	event: StreamsEvent,
): event is StreamsEvent & { event_type: "stx_transfer" } {
	return event.event_type === "stx_transfer";
}

export function decodeStxTransfer(event: StreamsEvent): DecodedStxTransfer {
	if (!isStxTransfer(event)) {
		throw new Error(`Expected stx_transfer event, got ${event.event_type}`);
	}
	const payload = event.payload;
	return decodedRow(event, "stx_transfer", {
		sender: requireString(payload, "sender", "stx_transfer"),
		recipient: requireString(payload, "recipient", "stx_transfer"),
		amount: requireAmount(payload, "stx_transfer"),
		memo: optionalString(payload.memo),
	});
}

export function isStxMint(
	event: StreamsEvent,
): event is StreamsEvent & { event_type: "stx_mint" } {
	return event.event_type === "stx_mint";
}

export function decodeStxMint(event: StreamsEvent): DecodedStxMint {
	if (!isStxMint(event)) {
		throw new Error(`Expected stx_mint event, got ${event.event_type}`);
	}
	const payload = event.payload;
	return decodedRow(event, "stx_mint", {
		recipient: requireString(payload, "recipient", "stx_mint"),
		amount: requireAmount(payload, "stx_mint"),
	});
}

export function isStxBurn(
	event: StreamsEvent,
): event is StreamsEvent & { event_type: "stx_burn" } {
	return event.event_type === "stx_burn";
}

export function decodeStxBurn(event: StreamsEvent): DecodedStxBurn {
	if (!isStxBurn(event)) {
		throw new Error(`Expected stx_burn event, got ${event.event_type}`);
	}
	const payload = event.payload;
	return decodedRow(event, "stx_burn", {
		sender: requireString(payload, "sender", "stx_burn"),
		amount: requireAmount(payload, "stx_burn"),
	});
}
