import type { StreamsEvent } from "./types.ts";

/** Superset of the columns the decoded_events table holds. Every decoded
 *  event's `decoded_payload` is assignable to this, so the indexer's writer
 *  can map columns generically instead of per-event-type. */
export type DecodedEventColumns = {
	contract_id?: string | null;
	asset_identifier?: string | null;
	sender?: string | null;
	recipient?: string | null;
	amount?: string | null;
	value?: string | null;
	memo?: string | null;
	/** JSONB overflow for non-flat types (e.g. print's decoded value). */
	payload?: unknown;
};

export function requireString(
	payload: Record<string, unknown>,
	field: string,
	eventType: string,
): string {
	const value = payload[field];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${eventType} payload missing ${field}`);
	}
	return value;
}

export function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function requireAmountField(
	payload: Record<string, unknown>,
	field: string,
	eventType: string,
): string {
	const amount = requireString(payload, field, eventType);
	if (!/^(0|[1-9]\d*)$/.test(amount)) {
		throw new Error(`${eventType} payload has malformed ${field}`);
	}
	return amount;
}

export function requireAmount(
	payload: Record<string, unknown>,
	eventType: string,
): string {
	return requireAmountField(payload, "amount", eventType);
}

export function parseAssetIdentifier(
	assetIdentifier: string,
	eventType: string,
): { contract_id: string; token_name: string | null } {
	const [contractId, tokenName] = assetIdentifier.split("::");
	if (!contractId) {
		throw new Error(`${eventType} payload has malformed asset_identifier`);
	}
	return {
		contract_id: contractId,
		token_name: tokenName && tokenName.length > 0 ? tokenName : null,
	};
}

/** NFT token id: live streams emits a typed Clarity value at `value` and the
 *  canonical hex at `raw_value`; prefer raw_value when present. */
export function requireHexValue(
	payload: Record<string, unknown>,
	eventType: string,
): string {
	const rawValue = payload.raw_value;
	if (typeof rawValue === "string") {
		if (!/^0x[0-9a-fA-F]*$/.test(rawValue)) {
			throw new Error(`${eventType} payload has malformed value`);
		}
		return rawValue;
	}

	const value = payload.value;
	const hex =
		typeof value === "string"
			? value
			: value &&
					typeof value === "object" &&
					typeof (value as { hex?: unknown }).hex === "string"
				? (value as { hex: string }).hex
				: null;

	if (!hex) {
		throw new Error(`${eventType} payload missing value`);
	}
	if (!/^0x[0-9a-fA-F]*$/.test(hex)) {
		throw new Error(`${eventType} payload has malformed value`);
	}
	return hex;
}

/** Common envelope fields shared by every decoded event, lifted off the
 *  source StreamsEvent. The decoder supplies event_type + decoded_payload. */
export function decodedRow<T extends string, P>(
	event: StreamsEvent,
	eventType: T,
	decoded_payload: P,
): {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: T;
	decoded_payload: P;
	source_cursor: string;
} {
	return {
		cursor: event.cursor,
		block_height: event.block_height,
		tx_id: event.tx_id,
		tx_index: event.tx_index,
		event_index: event.event_index,
		event_type: eventType,
		decoded_payload,
		source_cursor: event.cursor,
	};
}
