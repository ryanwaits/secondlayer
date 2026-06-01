import {
	decodedRow,
	parseAssetIdentifier,
	requireHexValue,
	requireString,
} from "./_payload.ts";
import type { StreamsEvent } from "./types.ts";

export type { NftTransferPayload } from "./types.ts";

export type NftTransferEvent = Extract<
	StreamsEvent,
	{ event_type: "nft_transfer" }
>;

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

export function isNftTransfer(event: StreamsEvent): event is NftTransferEvent {
	return event.event_type === "nft_transfer";
}

export function decodeNftTransfer(event: StreamsEvent): DecodedNftTransfer {
	if (!isNftTransfer(event)) {
		throw new Error(`Expected nft_transfer event, got ${event.event_type}`);
	}

	const payload = event.payload;
	const assetIdentifier = requireString(
		payload,
		"asset_identifier",
		"nft_transfer",
	);
	const sender = requireString(payload, "sender", "nft_transfer");
	const recipient = requireString(payload, "recipient", "nft_transfer");
	const value = requireHexValue(payload, "nft_transfer");
	const { contract_id, token_name } = parseAssetIdentifier(
		assetIdentifier,
		"nft_transfer",
	);

	return decodedRow(event, "nft_transfer", {
		asset_identifier: assetIdentifier,
		contract_id: event.contract_id ?? contract_id,
		token_name,
		sender,
		recipient,
		value,
	});
}
