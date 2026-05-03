import type { StreamsEvent } from "./types.ts";

export type FtTransferPayload = {
	asset_identifier: string;
	sender: string;
	recipient: string;
	amount: string;
};

export type FtTransferEvent = StreamsEvent & {
	event_type: "ft_transfer";
	payload: FtTransferPayload;
};

export type DecodedFtTransferPayload = {
	asset_identifier: string;
	contract_id: string;
	token_name: string | null;
	sender: string;
	recipient: string;
	amount: string;
};

export type DecodedFtTransfer = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "ft_transfer";
	decoded_payload: DecodedFtTransferPayload;
	source_cursor: string;
};

export type DecodedEventRow = DecodedFtTransfer;

function requireString(
	payload: Record<string, unknown>,
	field: keyof FtTransferPayload,
): string {
	const value = payload[field];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`ft_transfer payload missing ${field}`);
	}
	return value;
}

function parseAssetIdentifier(assetIdentifier: string): {
	contract_id: string;
	token_name: string | null;
} {
	const [contractId, tokenName] = assetIdentifier.split("::");
	if (!contractId) {
		throw new Error("ft_transfer payload has malformed asset_identifier");
	}
	return {
		contract_id: contractId,
		token_name: tokenName && tokenName.length > 0 ? tokenName : null,
	};
}

export function isFtTransfer(event: StreamsEvent): event is FtTransferEvent {
	return event.event_type === "ft_transfer";
}

export function decodeFtTransfer(event: StreamsEvent): DecodedFtTransfer {
	if (!isFtTransfer(event)) {
		throw new Error(`Expected ft_transfer event, got ${event.event_type}`);
	}

	const payload = event.payload;
	const assetIdentifier = requireString(payload, "asset_identifier");
	const sender = requireString(payload, "sender");
	const recipient = requireString(payload, "recipient");
	const amount = requireString(payload, "amount");
	if (!/^(0|[1-9]\d*)$/.test(amount)) {
		throw new Error("ft_transfer payload has malformed amount");
	}

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
			amount,
		},
		source_cursor: event.cursor,
	};
}
