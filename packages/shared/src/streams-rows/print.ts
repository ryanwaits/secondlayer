import { clarityHexOf, decodedRow, optionalString } from "./_payload.ts";
import { decodeClarityValue, toJsonSafe } from "./clarity.ts";
import type { StreamsEvent } from "./events.ts";

/** Decoded form of a Clarity `print` event:
 *  - `topic`: the print topic, when the contract emits a `{ topic, ... }` tuple
 *  - `value`: the Clarity value decoded to JSON (uints as strings, buffers as
 *    `0x…` hex, tuples as objects)
 *  - `raw_value`: the canonical serialized hex, for byte-exact consumers */
export type DecodedPrintValue = {
	topic: string | null;
	value: unknown;
	raw_value: string | null;
};

export type DecodedPrintPayload = {
	contract_id: string | null;
	payload: DecodedPrintValue;
};

export type DecodedPrint = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "print";
	decoded_payload: DecodedPrintPayload;
};

export function isPrint(
	event: StreamsEvent,
): event is StreamsEvent & { event_type: "print" } {
	return event.event_type === "print";
}

export function decodePrint(event: StreamsEvent): DecodedPrint {
	if (!isPrint(event)) {
		throw new Error(`Expected print event, got ${event.event_type}`);
	}
	const payload = event.payload;
	const topic = optionalString(payload.topic);
	const rawValue = clarityHexOf(payload);

	const value = rawValue
		? decodeClarityValue(rawValue)
		: toJsonSafe(payload.value ?? null);

	return decodedRow(event, "print", {
		contract_id: event.contract_id ?? optionalString(payload.contract_id),
		payload: { topic, value, raw_value: rawValue },
	});
}

const CANONICAL_HEX = /^0x(?:[0-9a-f]{2})+$/;

export type StoredPrintColumns = {
	payload: unknown;
	raw_value: Uint8Array | null;
};

export function printRawValueBytes(rawValue: string | null): Buffer | null {
	if (!rawValue || !CANONICAL_HEX.test(rawValue)) return null;
	return Buffer.from(rawValue.slice(2), "hex");
}

export function printPayloadFromStored(
	stored: StoredPrintColumns,
): DecodedPrintValue | null {
	if (stored.raw_value) {
		const hex = `0x${Buffer.from(stored.raw_value).toString("hex")}`;
		return { topic: "print", value: decodeClarityValue(hex), raw_value: hex };
	}
	const legacy = stored.payload;
	if (typeof legacy === "string") {
		try {
			return JSON.parse(legacy) as DecodedPrintValue;
		} catch {
			return null;
		}
	}
	if (legacy && typeof legacy === "object") return legacy as DecodedPrintValue;
	return null;
}
