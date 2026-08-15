import {
	decodedRow,
	parseAssetIdentifier,
	requireAmount,
	requireHexValue,
	requireString,
} from "./_payload.ts";
import type { StreamsEvent } from "./types.ts";

export type DecodedFtMintPayload = {
	asset_identifier: string;
	contract_id: string;
	token_name: string | null;
	recipient: string;
	amount: string;
};

export type DecodedFtMint = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "ft_mint";
	decoded_payload: DecodedFtMintPayload;
	source_cursor: string;
};

export type DecodedFtBurnPayload = {
	asset_identifier: string;
	contract_id: string;
	token_name: string | null;
	sender: string;
	amount: string;
};

export type DecodedFtBurn = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "ft_burn";
	decoded_payload: DecodedFtBurnPayload;
	source_cursor: string;
};

export type DecodedNftMintPayload = {
	asset_identifier: string;
	contract_id: string;
	token_name: string | null;
	recipient: string;
	value: string;
};

export type DecodedNftMint = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "nft_mint";
	decoded_payload: DecodedNftMintPayload;
	source_cursor: string;
};

export type DecodedNftBurnPayload = {
	asset_identifier: string;
	contract_id: string;
	token_name: string | null;
	sender: string;
	value: string;
};

export type DecodedNftBurn = {
	cursor: string;
	block_height: number;
	tx_id: string;
	tx_index: number;
	event_index: number;
	event_type: "nft_burn";
	decoded_payload: DecodedNftBurnPayload;
	source_cursor: string;
};

function assetFields(event: StreamsEvent, eventType: string) {
	const assetIdentifier = requireString(
		event.payload,
		"asset_identifier",
		eventType,
	);
	const { contract_id, token_name } = parseAssetIdentifier(
		assetIdentifier,
		eventType,
	);
	return {
		asset_identifier: assetIdentifier,
		contract_id: event.contract_id ?? contract_id,
		token_name,
	};
}

export function isFtMint(
	event: StreamsEvent,
): event is StreamsEvent & { event_type: "ft_mint" } {
	return event.event_type === "ft_mint";
}

export function decodeFtMint(event: StreamsEvent): DecodedFtMint {
	if (!isFtMint(event)) {
		throw new Error(`Expected ft_mint event, got ${event.event_type}`);
	}
	return decodedRow(event, "ft_mint", {
		...assetFields(event, "ft_mint"),
		recipient: requireString(event.payload, "recipient", "ft_mint"),
		amount: requireAmount(event.payload, "ft_mint"),
	});
}

export function isFtBurn(
	event: StreamsEvent,
): event is StreamsEvent & { event_type: "ft_burn" } {
	return event.event_type === "ft_burn";
}

export function decodeFtBurn(event: StreamsEvent): DecodedFtBurn {
	if (!isFtBurn(event)) {
		throw new Error(`Expected ft_burn event, got ${event.event_type}`);
	}
	return decodedRow(event, "ft_burn", {
		...assetFields(event, "ft_burn"),
		sender: requireString(event.payload, "sender", "ft_burn"),
		amount: requireAmount(event.payload, "ft_burn"),
	});
}

export function isNftMint(
	event: StreamsEvent,
): event is StreamsEvent & { event_type: "nft_mint" } {
	return event.event_type === "nft_mint";
}

export function decodeNftMint(event: StreamsEvent): DecodedNftMint {
	if (!isNftMint(event)) {
		throw new Error(`Expected nft_mint event, got ${event.event_type}`);
	}
	return decodedRow(event, "nft_mint", {
		...assetFields(event, "nft_mint"),
		recipient: requireString(event.payload, "recipient", "nft_mint"),
		value: requireHexValue(event.payload, "nft_mint"),
	});
}

export function isNftBurn(
	event: StreamsEvent,
): event is StreamsEvent & { event_type: "nft_burn" } {
	return event.event_type === "nft_burn";
}

export function decodeNftBurn(event: StreamsEvent): DecodedNftBurn {
	if (!isNftBurn(event)) {
		throw new Error(`Expected nft_burn event, got ${event.event_type}`);
	}
	return decodedRow(event, "nft_burn", {
		...assetFields(event, "nft_burn"),
		sender: requireString(event.payload, "sender", "nft_burn"),
		value: requireHexValue(event.payload, "nft_burn"),
	});
}
