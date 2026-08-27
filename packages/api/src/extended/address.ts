import { getSourceDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import type { Kysely } from "kysely";

/** Decoded STX movement row used by netStx. */
export type StxNetRow = {
	event_type: string;
	sender: string | null;
	recipient: string | null;
	amount: string | null;
};

export type ExtendedStxTotals = {
	balance: string;
	total_sent: string;
	total_received: string;
	locked?: string;
	lock_tx_id?: string;
	unlock_height?: number | string;
};

export type StxLockRow = {
	amount: string | null;
	tx_id: string;
	block_height: number | string;
	event_index: number | string;
	payload: unknown | null;
};

/** Parse a non-negative integer amount string; null if invalid. */
function parseAmount(raw: string | null | undefined): bigint | null {
	if (raw === null || raw === undefined || raw === "") return null;
	if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
	try {
		return BigInt(raw);
	} catch {
		return null;
	}
}

/**
 * Net STX from decoded rows for a principal.
 * received = stx_transfer→recipient + stx_mint→recipient
 * sent = stx_transfer→sender + stx_burn→sender
 * Invalid amounts skipped.
 */
export function netStx(
	rows: StxNetRow[],
	principal: string,
): { balance: string; total_sent: string; total_received: string } {
	let received = 0n;
	let sent = 0n;
	for (const row of rows) {
		const amount = parseAmount(row.amount);
		if (amount === null) continue;
		if (
			(row.event_type === "stx_transfer" || row.event_type === "stx_mint") &&
			row.recipient === principal
		) {
			received += amount;
		}
		if (
			(row.event_type === "stx_transfer" || row.event_type === "stx_burn") &&
			row.sender === principal
		) {
			sent += amount;
		}
	}
	return {
		total_received: received.toString(),
		total_sent: sent.toString(),
		balance: (received - sent).toString(),
	};
}

/** Project latest stx_lock row into optional locked fields. */
export function projectStxLock(
	row: StxLockRow | null | undefined,
): Pick<ExtendedStxTotals, "locked" | "lock_tx_id" | "unlock_height"> {
	if (!row) return {};
	const locked = parseAmount(row.amount);
	if (locked === null) return {};
	const out: Pick<
		ExtendedStxTotals,
		"locked" | "lock_tx_id" | "unlock_height"
	> = {
		locked: locked.toString(),
		lock_tx_id: row.tx_id,
	};
	if (
		row.payload &&
		typeof row.payload === "object" &&
		!Array.isArray(row.payload) &&
		"unlock_height" in row.payload
	) {
		const uh = (row.payload as { unlock_height: unknown }).unlock_height;
		if (uh !== null && uh !== undefined) {
			out.unlock_height = uh as number | string;
		}
	}
	return out;
}

export type GetExtendedStx = (principal: string) => Promise<ExtendedStxTotals>;

/** Canonical decoded STX totals + latest lock for a principal. */
export async function getExtendedStx(
	principal: string,
	db: Kysely<Database> = getSourceDb(),
): Promise<ExtendedStxTotals> {
	const { rows } = await sql<StxNetRow>`
		SELECT event_type, sender, recipient, amount
		FROM decoded_events
		WHERE canonical = true
			AND event_type IN ('stx_transfer', 'stx_mint', 'stx_burn')
			AND (sender = ${principal} OR recipient = ${principal})
	`.execute(db);

	const totals = netStx(rows, principal);

	const { rows: lockRows } = await sql<StxLockRow>`
		SELECT amount, tx_id, block_height, event_index, payload
		FROM decoded_events
		WHERE canonical = true
			AND event_type = 'stx_lock'
			AND sender = ${principal}
		ORDER BY block_height DESC, event_index DESC
		LIMIT 1
	`.execute(db);

	return {
		...totals,
		...projectStxLock(lockRows[0]),
	};
}

/** Decoded FT movement row used by netFt. */
export type FtNetRow = {
	event_type: string;
	asset_identifier: string | null;
	sender: string | null;
	recipient: string | null;
	amount: string | null;
};

export type ExtendedFtHolding = {
	asset_identifier: string;
	balance: string;
};

/**
 * Net FT holdings per asset_identifier. Drops net 0.
 * in = ft_mint/ft_transfer → recipient; out = ft_burn/ft_transfer → sender.
 */
export function netFt(
	rows: FtNetRow[],
	principal: string,
): ExtendedFtHolding[] {
	const nets = new Map<string, bigint>();
	for (const row of rows) {
		if (!row.asset_identifier) continue;
		const amount = parseAmount(row.amount);
		if (amount === null) continue;
		let delta = 0n;
		if (
			(row.event_type === "ft_mint" || row.event_type === "ft_transfer") &&
			row.recipient === principal
		) {
			delta += amount;
		}
		if (
			(row.event_type === "ft_burn" || row.event_type === "ft_transfer") &&
			row.sender === principal
		) {
			delta -= amount;
		}
		if (delta === 0n) continue;
		nets.set(
			row.asset_identifier,
			(nets.get(row.asset_identifier) ?? 0n) + delta,
		);
	}
	const out: ExtendedFtHolding[] = [];
	for (const [asset_identifier, balance] of nets) {
		if (balance === 0n) continue;
		out.push({ asset_identifier, balance: balance.toString() });
	}
	out.sort((a, b) => a.asset_identifier.localeCompare(b.asset_identifier));
	return out;
}

export type ListExtendedFtQuery = {
	principal: string;
	limit: number;
	offset: number;
};

export type ListExtendedFtResult = {
	results: ExtendedFtHolding[];
	total: number;
};

export type ListExtendedFt = (
	q: ListExtendedFtQuery,
) => Promise<ListExtendedFtResult>;

export async function listExtendedFt(
	q: ListExtendedFtQuery,
	db: Kysely<Database> = getSourceDb(),
): Promise<ListExtendedFtResult> {
	const { rows } = await sql<FtNetRow>`
		SELECT event_type, asset_identifier, sender, recipient, amount
		FROM decoded_events
		WHERE canonical = true
			AND event_type IN ('ft_mint', 'ft_transfer', 'ft_burn')
			AND (sender = ${q.principal} OR recipient = ${q.principal})
	`.execute(db);

	const all = netFt(rows, q.principal);
	return {
		total: all.length,
		results: all.slice(q.offset, q.offset + q.limit),
	};
}

/** Decoded NFT movement row used by netNft. */
export type NftNetRow = {
	event_type: string;
	asset_identifier: string | null;
	value: string | null;
	sender: string | null;
	recipient: string | null;
};

export type ExtendedNftHolding = {
	asset_identifier: string;
	value: string;
};

/**
 * Current NFT holdings. Identity = (asset_identifier, value).
 * Held after mint/transfer-in without a later burn/transfer-out.
 */
export function netNft(
	rows: NftNetRow[],
	principal: string,
): ExtendedNftHolding[] {
	const held = new Set<string>();
	const key = (asset: string, value: string) => `${asset}\0${value}`;

	for (const row of rows) {
		if (
			!row.asset_identifier ||
			row.value === null ||
			row.value === undefined
		) {
			continue;
		}
		const k = key(row.asset_identifier, row.value);
		if (
			(row.event_type === "nft_mint" || row.event_type === "nft_transfer") &&
			row.recipient === principal
		) {
			held.add(k);
		}
		if (
			(row.event_type === "nft_burn" || row.event_type === "nft_transfer") &&
			row.sender === principal
		) {
			held.delete(k);
		}
	}

	const out: ExtendedNftHolding[] = [];
	for (const k of held) {
		const sep = k.indexOf("\0");
		out.push({
			asset_identifier: k.slice(0, sep),
			value: k.slice(sep + 1),
		});
	}
	out.sort((a, b) => {
		const c = a.asset_identifier.localeCompare(b.asset_identifier);
		return c !== 0 ? c : a.value.localeCompare(b.value);
	});
	return out;
}

export type ListExtendedNftQuery = {
	principal: string;
	limit: number;
	offset: number;
};

export type ListExtendedNftResult = {
	results: ExtendedNftHolding[];
	total: number;
};

export type ListExtendedNft = (
	q: ListExtendedNftQuery,
) => Promise<ListExtendedNftResult>;

export async function listExtendedNft(
	q: ListExtendedNftQuery,
	db: Kysely<Database> = getSourceDb(),
): Promise<ListExtendedNftResult> {
	const { rows } = await sql<NftNetRow>`
		SELECT
			event_type,
			asset_identifier,
			value,
			sender,
			recipient,
			block_height,
			event_index
		FROM decoded_events
		WHERE canonical = true
			AND event_type IN ('nft_mint', 'nft_transfer', 'nft_burn')
			AND (sender = ${q.principal} OR recipient = ${q.principal})
		ORDER BY block_height ASC, event_index ASC
	`.execute(db);

	const all = netNft(rows, q.principal);
	return {
		total: all.length,
		results: all.slice(q.offset, q.offset + q.limit),
	};
}
