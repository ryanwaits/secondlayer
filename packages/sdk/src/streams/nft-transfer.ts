import type { StreamsEvent } from "./types.ts";

export type NftTransferPayload = {
	asset_identifier: string;
	sender: string;
	recipient: string;
	value: string | { hex: string };
};

export type NftTransferEvent = StreamsEvent & {
	event_type: "nft_transfer";
	payload: NftTransferPayload;
};

export type DecodedNftTransferPayload = {
	asset_identifier: string;
	contract_id: string;
	token_name: string | null;
	sender: string;
	recipient: string;
	value: string;
};

export type DecodedNftTransfer = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "nft_transfer";
	decoded_payload: DecodedNftTransferPayload;
	source_cursor: string;
};

function requireString(
	payload: Record<string, unknown>,
	field: "asset_identifier" | "sender" | "recipient",
): string {
	const value = payload[field];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`nft_transfer payload missing ${field}`);
	}
	return value;
}

function requireHexValue(payload: Record<string, unknown>): string {
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
		throw new Error("nft_transfer payload missing value");
	}
	if (!/^0x[0-9a-fA-F]*$/.test(hex)) {
		throw new Error("nft_transfer payload has malformed value");
	}
	return hex;
}

function parseAssetIdentifier(assetIdentifier: string): {
	contract_id: string;
	token_name: string | null;
} {
	const [contractId, tokenName] = assetIdentifier.split("::");
	if (!contractId) {
		throw new Error("nft_transfer payload has malformed asset_identifier");
	}
	return {
		contract_id: contractId,
		token_name: tokenName && tokenName.length > 0 ? tokenName : null,
	};
}

export function isNftTransfer(event: StreamsEvent): event is NftTransferEvent {
	return event.event_type === "nft_transfer";
}

export function decodeNftTransfer(event: StreamsEvent): DecodedNftTransfer {
	if (!isNftTransfer(event)) {
		throw new Error(`Expected nft_transfer event, got ${event.event_type}`);
	}

	const payload = event.payload;
	const assetIdentifier = requireString(payload, "asset_identifier");
	const sender = requireString(payload, "sender");
	const recipient = requireString(payload, "recipient");
	const value = requireHexValue(payload);
	const { contract_id, token_name } = parseAssetIdentifier(assetIdentifier);

	return {
		cursor: event.cursor,
		block_height: event.block_height,
		tx_id: event.tx_id,
		tx_index: event.tx_index,
		event_index: event.event_index,
		event_type: event.event_type,
		decoded_payload: {
			asset_identifier: assetIdentifier,
			contract_id: event.contract_id ?? contract_id,
			token_name,
			sender,
			recipient,
			value,
		},
		source_cursor: event.cursor,
	};
}
