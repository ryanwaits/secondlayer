import { cvToValue, deserializeCV } from "@secondlayer/stacks/clarity";
import { decodedRow, optionalString } from "./_payload.ts";
import type { StreamsEvent } from "./types.ts";

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
	source_cursor: string;
};

function printValueHex(payload: Record<string, unknown>): string | null {
	if (typeof payload.raw_value === "string") return payload.raw_value;
	const value = payload.value;
	if (typeof value === "string" && value.startsWith("0x")) return value;
	if (
		value &&
		typeof value === "object" &&
		typeof (value as { hex?: unknown }).hex === "string"
	) {
		return (value as { hex: string }).hex;
	}
	return null;
}

/** cvToValue yields bigint for Clarity (u)ints; convert recursively to strings
 *  so the decoded value is JSON-serializable for the jsonb column / API. */
function toJsonSafe(value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (Array.isArray(value)) return value.map(toJsonSafe);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			out[key] = toJsonSafe(val);
		}
		return out;
	}
	return value;
}

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
	const rawValue = printValueHex(payload);

	let value: unknown;
	if (rawValue) {
		try {
			const hex = rawValue.startsWith("0x") ? rawValue.slice(2) : rawValue;
			value = toJsonSafe(cvToValue(deserializeCV(hex)));
		} catch {
			value = toJsonSafe(payload.value ?? null);
		}
	} else {
		value = toJsonSafe(payload.value ?? null);
	}

	return decodedRow(event, "print", {
		contract_id: event.contract_id ?? optionalString(payload.contract_id),
		payload: { topic, value, raw_value: rawValue },
	});
}
