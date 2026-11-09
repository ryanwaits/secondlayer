import type { StreamsEvent } from "./events.ts";

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

const HEX_BODY = /^[0-9a-fA-F]*$/;

/** The canonical `0x` hex of a payload's Clarity value, from whichever field
 *  the row's ingestion era wrote: `raw_value` (from ~7.46M), a `0x` string at
 *  `value` (before that), or a typed `{ hex }` object. Null when none is hex. */
export function clarityHexOf(payload: Record<string, unknown>): string | null {
	const rawValue = payload.raw_value;
	if (typeof rawValue === "string") return rawValue;
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

/** NFT token id as canonical `0x` hex; throws when missing or malformed. */
export function requireHexValue(
	payload: Record<string, unknown>,
	eventType: string,
): string {
	const hex =
		clarityHexOf(payload) ??
		(typeof payload.value === "string" ? payload.value : null);
	if (!hex) {
		throw new Error(`${eventType} payload missing value`);
	}
	if (!/^0x[0-9a-fA-F]*$/.test(hex)) {
		throw new Error(`${eventType} payload has malformed value`);
	}
	return hex;
}

/**
 * A transfer memo as `0x` hex, or null when the transfer carried none.
 *
 * Stored memos come in three spellings depending on ingestion era: `0x…`
 * (before ~7.4M), bare hex (after), and missing or `""` for transfers made
 * without a memo. Non-hex strings pass through untouched.
 */
export function normalizeMemoHex(memo: unknown): string | null {
	if (typeof memo !== "string") return null;
	const body = memo.startsWith("0x") ? memo.slice(2) : memo;
	if (body.length === 0) return null;
	return HEX_BODY.test(body) ? `0x${body}` : memo;
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
