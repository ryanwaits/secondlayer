import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

/** Hiro TransactionEvent event_type values we project. */
export type ExtendedHiroEventType =
	| "stx_asset"
	| "fungible_token_asset"
	| "non_fungible_token_asset"
	| "smart_contract_log";

export type ExtendedAssetEventType = "transfer" | "mint" | "burn";

/**
 * ours → Hiro event_type.
 * stx_lock → stx_asset with asset_event_type omitted (not inventing "lock").
 */
const OURS_TO_HIRO_EVENT_TYPE: Record<string, ExtendedHiroEventType> = {
	stx_transfer: "stx_asset",
	stx_mint: "stx_asset",
	stx_burn: "stx_asset",
	stx_lock: "stx_asset",
	ft_transfer: "fungible_token_asset",
	ft_mint: "fungible_token_asset",
	ft_burn: "fungible_token_asset",
	nft_transfer: "non_fungible_token_asset",
	nft_mint: "non_fungible_token_asset",
	nft_burn: "non_fungible_token_asset",
	print: "smart_contract_log",
};

function assetEventTypeFromOurs(
	ours: string,
): ExtendedAssetEventType | undefined {
	if (ours.endsWith("_transfer")) return "transfer";
	if (ours.endsWith("_mint")) return "mint";
	if (ours.endsWith("_burn")) return "burn";
	// stx_lock and anything else: omit rather than invent
	return undefined;
}

/** Hiro-ish TransactionEvent subset. Omits hex/repr we do not persist. */
export type ExtendedTxEvent = {
	event_index: number;
	event_type: ExtendedHiroEventType;
	tx_id: string;
	asset?: {
		asset_event_type?: ExtendedAssetEventType;
		sender?: string | null;
		recipient?: string | null;
		amount?: string | null;
		asset_id?: string | null;
		value?: string | null;
		memo?: string | null;
	};
	contract_log?: {
		contract_id: string | null;
		topic?: unknown;
		value?: unknown;
	};
};

export type DecodedEventRow = {
	tx_id: string;
	event_index: number | string;
	event_type: string;
	contract_id: string | null;
	sender: string | null;
	recipient: string | null;
	amount: string | null;
	asset_identifier: string | null;
	value: string | null;
	memo: string | null;
	payload: unknown | null;
};

/** Map a decoded_events row; unknown our-types → null (caller skips). */
export function projectDecodedEventToHiro(
	row: DecodedEventRow,
): ExtendedTxEvent | null {
	const hiroType = OURS_TO_HIRO_EVENT_TYPE[row.event_type];
	if (!hiroType) return null;

	const event_index = Number(row.event_index);
	const base: ExtendedTxEvent = {
		event_index,
		event_type: hiroType,
		tx_id: row.tx_id,
	};

	if (hiroType === "smart_contract_log") {
		const contractLog: NonNullable<ExtendedTxEvent["contract_log"]> = {
			contract_id: row.contract_id,
		};
		if (
			row.payload &&
			typeof row.payload === "object" &&
			!Array.isArray(row.payload)
		) {
			const p = row.payload as Record<string, unknown>;
			if ("topic" in p) contractLog.topic = p.topic;
			if ("value" in p) contractLog.value = p.value;
		}
		base.contract_log = contractLog;
		return base;
	}

	const asset: NonNullable<ExtendedTxEvent["asset"]> = {};
	const aet = assetEventTypeFromOurs(row.event_type);
	if (aet !== undefined) asset.asset_event_type = aet;

	if (hiroType === "stx_asset") {
		if (row.sender != null) asset.sender = row.sender;
		if (row.recipient != null) asset.recipient = row.recipient;
		if (row.amount != null) asset.amount = row.amount;
		if (row.memo != null) asset.memo = row.memo;
	} else if (hiroType === "fungible_token_asset") {
		if (row.asset_identifier != null) asset.asset_id = row.asset_identifier;
		if (row.sender != null) asset.sender = row.sender;
		if (row.recipient != null) asset.recipient = row.recipient;
		if (row.amount != null) asset.amount = row.amount;
	} else {
		// non_fungible_token_asset
		if (row.asset_identifier != null) asset.asset_id = row.asset_identifier;
		if (row.sender != null) asset.sender = row.sender;
		if (row.recipient != null) asset.recipient = row.recipient;
		if (row.value != null) asset.value = row.value;
	}

	base.asset = asset;
	return base;
}

export type ListExtendedTxEvents = (txId: string) => Promise<ExtendedTxEvent[]>;

/** Canonical decoded_events for a tx, ordered by event_index. Unknown types dropped. */
export async function listExtendedTxEvents(
	txId: string,
	db: Kysely<Database> = getSourceDb(),
): Promise<ExtendedTxEvent[]> {
	const { rows } = await sql<DecodedEventRow>`
		SELECT
			tx_id,
			event_index,
			event_type,
			contract_id,
			sender,
			recipient,
			amount,
			asset_identifier,
			value,
			memo,
			payload
		FROM decoded_events
		WHERE tx_id = ${txId} AND canonical = true
		ORDER BY event_index ASC
	`.execute(db);

	const out: ExtendedTxEvent[] = [];
	for (const row of rows) {
		const projected = projectDecodedEventToHiro(row);
		if (projected) out.push(projected);
	}
	return out;
}
