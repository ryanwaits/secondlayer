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

const REQUIRED_PRESENT_FIELDS: Record<string, readonly string[]> = {
	nft_transfer_event: ["value"],
	nft_mint_event: ["value"],
	nft_burn_event: ["value"],
	smart_contract_event: ["value"],
};

export function isValidatedStreamsDbEventType(dbEventType: string): boolean {
	return dbEventType in REQUIRED_STRING_FIELDS;
}

export function validateStreamsEventPayload(
	dbEventType: string,
	data: unknown,
): string | null {
	const stringFields = REQUIRED_STRING_FIELDS[dbEventType];
	if (!stringFields) return null;

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
