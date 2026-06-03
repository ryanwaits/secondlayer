import type { Block, Event, Transaction } from "@secondlayer/shared/db";
import type {
	IndexBlockRow,
	IndexEventRow,
	IndexTransactionRow,
} from "@secondlayer/shared/index-http";

export type {
	IndexBlockRow,
	IndexEventRow,
	IndexTransactionRow,
} from "@secondlayer/shared/index-http";

/**
 * Reconstruct the raw `blocks`/`events` row shapes the subgraph runtime expects
 * (the shapes `matchSources` + the handler runner read) from the decoded,
 * flattened rows the public Index API serves. This is what lets
 * `PublicApiBlockSource` feed the EXISTING pipeline byte-identically to the
 * Postgres tap.
 *
 * Two shape gaps the Index API can't avoid, handled here:
 *  - Index event rows are flat (`event_type: "ft_transfer"`, columns
 *    `sender`/`amount`/…); the runtime expects the node's nested `data` keyed by
 *    a suffixed `type` (`ft_transfer_event`), with print under `contract_event`.
 *  - nft/print Clarity values: the runtime decodes from the canonical hex
 *    (`raw_value`), so we place the Index hex there. (The node's verbose
 *    serde-tagged `value`, e.g. `{UInt:223}`, is not reproducible from hex and
 *    is no longer read — see the nft tokenId normalization in runner.ts.)
 */

/** ISO `block_time` (or null) → unix-seconds integer the runtime expects. */
function isoToUnixSeconds(iso: string | null): number {
	if (!iso) return 0;
	return Math.floor(new Date(iso).getTime() / 1000);
}

export function reconstructBlock(b: IndexBlockRow): Block {
	return {
		height: b.block_height,
		hash: b.block_hash,
		parent_hash: b.parent_hash,
		burn_block_height: b.burn_block_height,
		burn_block_hash: b.burn_block_hash,
		timestamp: isoToUnixSeconds(b.block_time),
		// Index serves canonical rows only.
		canonical: true,
		created_at: new Date(0),
	} as Block;
}

export function reconstructTransaction(t: IndexTransactionRow): Transaction {
	return {
		tx_id: t.tx_id,
		block_height: t.block_height,
		tx_index: t.tx_index,
		type: t.tx_type,
		sender: t.sender,
		status: t.status,
		contract_id:
			t.contract_call?.contract_id ?? t.smart_contract?.contract_id ?? null,
		function_name: t.contract_call?.function_name ?? null,
		// Phase-2 contract_call sources decode args from raw hex (S4.T1a); event
		// sources don't read them, so default empty here.
		function_args: t.contract_call?.function_args ?? [],
		raw_result: t.contract_call?.result_hex ?? null,
		raw_tx: "",
		created_at: new Date(0),
	} as Transaction;
}

export function reconstructEvent(e: IndexEventRow): Event {
	const base = {
		// Synthetic, deterministic id. The runtime only reads `id` for error logs
		// and the `*`-wildcard payload (which is streams-index-ineligible).
		id: `${e.tx_id}#${e.event_index}`,
		tx_id: e.tx_id,
		block_height: e.block_height,
		event_index: e.event_index,
		created_at: new Date(0),
	};

	switch (e.event_type) {
		case "ft_transfer":
		case "ft_mint":
		case "ft_burn":
			return {
				...base,
				type: `${e.event_type}_event`,
				data: {
					asset_identifier: e.asset_identifier,
					sender: e.sender,
					recipient: e.recipient,
					amount: e.amount,
				},
			} as Event;

		case "nft_transfer":
		case "nft_mint":
		case "nft_burn":
			return {
				...base,
				type: `${e.event_type}_event`,
				data: {
					asset_identifier: e.asset_identifier,
					sender: e.sender,
					recipient: e.recipient,
					// Canonical hex → runner decodes tokenId from raw_value.
					raw_value: e.value,
				},
			} as Event;

		case "stx_transfer":
		case "stx_mint":
		case "stx_burn":
			return {
				...base,
				type: `${e.event_type}_event`,
				data: {
					sender: e.sender,
					recipient: e.recipient,
					amount: e.amount,
					...("memo" in e ? { memo: e.memo ?? undefined } : {}),
				},
			} as Event;

		case "stx_lock":
			return {
				...base,
				type: "stx_lock_event",
				data: {
					locked_address: e.sender,
					locked_amount: e.amount,
					unlock_height: e.payload.unlock_height,
				},
			} as Event;

		case "print":
			return {
				...base,
				type: "contract_event",
				data: {
					topic: e.payload.topic,
					contract_id: e.contract_id,
					contract_identifier: e.contract_id,
					value: e.payload.value,
					raw_value: e.payload.raw_value,
				},
			} as Event;
	}
}
