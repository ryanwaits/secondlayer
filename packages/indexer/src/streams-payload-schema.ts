// Minimal payload validation for the Stacks node event types that Streams
// serves. Pure functions, no DB. Used by ingest (behind STREAMS_PAYLOAD_VALIDATION)
// to dead-letter malformed payloads for observability — the event itself is
// still persisted, so this never drops chain data.

/** Required non-empty string fields per node event type. */
const REQUIRED_STRING_FIELDS: Record<string, readonly string[]> = {
	stx_transfer_event: ["sender", "recipient", "amount"],
	stx_mint_event: ["recipient", "amount"],
	stx_burn_event: ["sender", "amount"],
	stx_lock_event: ["locked_address", "locked_amount", "unlock_height"],
	ft_transfer_event: ["asset_identifier", "sender", "recipient", "amount"],
	ft_mint_event: ["asset_identifier", "recipient", "amount"],
	ft_burn_event: ["asset_identifier", "sender", "amount"],
	nft_transfer_event: ["asset_identifier", "sender", "recipient"],
	nft_mint_event: ["asset_identifier", "recipient"],
	nft_burn_event: ["asset_identifier", "sender"],
	smart_contract_event: ["contract_identifier", "topic"],
};

/** Fields that must be present (any type), e.g. a Clarity `value`. */
const REQUIRED_PRESENT_FIELDS: Record<string, readonly string[]> = {
	nft_transfer_event: ["value"],
	nft_mint_event: ["value"],
	nft_burn_event: ["value"],
	smart_contract_event: ["value"],
};

/** Whether this node event type is one Streams serves (and thus validates). */
export function isValidatedStreamsDbEventType(dbEventType: string): boolean {
	return dbEventType in REQUIRED_STRING_FIELDS;
}

/**
 * Validate a raw event payload (`events.data`) against the minimal shape its
 * node event type requires. Returns a reason string when malformed, or null
 * when valid (or when the type isn't a validated Streams type).
 */
export function validateStreamsEventPayload(
	dbEventType: string,
	data: unknown,
): string | null {
	const stringFields = REQUIRED_STRING_FIELDS[dbEventType];
	if (!stringFields) return null; // not a Streams-served type → not validated

	if (data === null || typeof data !== "object" || Array.isArray(data)) {
		return "payload is not an object";
	}
	const record = data as Record<string, unknown>;

	for (const field of stringFields) {
		const value = record[field];
		if (typeof value !== "string" || value.length === 0) {
			return `missing or non-string field: ${field}`;
		}
	}
	for (const field of REQUIRED_PRESENT_FIELDS[dbEventType] ?? []) {
		if (record[field] === undefined || record[field] === null) {
			return `missing field: ${field}`;
		}
	}
	return null;
}
