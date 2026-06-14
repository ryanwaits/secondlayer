// Shared wire shapes + pure formatters for the sBTC Peg Explorer, used by both
// the server page (initial fetch) and the client live-feed component.

export interface Tip {
	block_height: number;
	finalized_height: number;
	lag_seconds: number;
}

export interface Deposit {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	amount: string; // sats
	bitcoin_txid: string; // 0x-prefixed
}

export interface Withdrawal {
	cursor: string;
	request_id: number;
	status: "REQUESTED" | "ACCEPTED" | "REJECTED";
	amount: string; // sats
	sender: string;
	sweep_txid: string | null; // 0x-prefixed, present once accepted
	requested_at: string;
	resolved_at: string | null;
}

export interface DepositEnvelope {
	deposits: Deposit[];
	next_cursor: string | null;
	tip: Tip;
}

export interface WithdrawalEnvelope {
	withdrawals: Withdrawal[];
	next_cursor: string | null;
	tip: Tip;
}

export interface SbtcSummary {
	total_deposits: number;
	total_withdrawals_requested: number;
	total_withdrawals_accepted: number;
	total_withdrawals_rejected: number;
	net_peg_flow_sats: string;
	total_locked_sats: string;
	sbtc_supply_sats: string | null;
}

export interface SummaryEnvelope {
	summary: SbtcSummary;
	tip: Tip;
}

/** Public, browser-reachable API base (client polling). Mirrors claim-flow.tsx. */
export const PUBLIC_API_URL =
	process.env.NEXT_PUBLIC_API_URL ?? "https://api.secondlayer.tools";
export const PUBLIC_SBTC = `${PUBLIC_API_URL}/v1/index/sbtc`;

export const num = new Intl.NumberFormat("en-US");

/** sats (string|number) → BTC string, up to `dp` decimals. */
export function btc(sats: string | number, dp = 8): string {
	const n = Number(sats) / 1e8;
	return n.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: dp,
	});
}

export function trunc(hex: string, head = 8, tail = 6): string {
	const h = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (h.length <= head + tail) return hex;
	return `${hex.startsWith("0x") ? "0x" : ""}${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function truncAddr(addr: string): string {
	if (addr.length <= 14) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-5)}`;
}

/** mempool.space wants raw hex, no 0x prefix. */
export const mempoolTx = (txid: string) =>
	`https://mempool.space/tx/${txid.startsWith("0x") ? txid.slice(2) : txid}`;
export const stacksTx = (txid: string) =>
	`https://explorer.hiro.so/txid/${txid}`;
export const stacksAddr = (addr: string) =>
	`https://explorer.hiro.so/address/${addr}`;

/**
 * Relative time. `nowMs` is passed in so SSR and first client render agree.
 * Sub-minute ages collapse to "< 1m ago": the feed polls on a delay, so a
 * precise "29s ago" would sit frozen and read as stale/inaccurate.
 */
export function ago(iso: string, nowMs: number): string {
	const secs = Math.max(
		0,
		Math.round((nowMs - new Date(iso).getTime()) / 1000),
	);
	if (secs < 60) return "< 1m ago";
	const mins = Math.round(secs / 60);
	if (mins < 90) return `${mins}m ago`;
	const hrs = Math.round(mins / 60);
	if (hrs < 36) return `${hrs}h ago`;
	return `${Math.round(hrs / 24)}d ago`;
}

/** Block height encoded in a `block:index` cursor (deposits + withdrawals). */
const cursorHeight = (cursor: string): number => Number(cursor.split(":")[0]);

const PAGE_CAP = 6;

/**
 * Walk the windowed list to its newest page, returning rows sorted newest-first.
 * The list is ascending and ~25/page; anon reads are clamped to a 24h window, so
 * this is a handful of pages. Used by both the server seed and the client poll.
 */
export async function fetchWindow(
	base: string,
	path: "deposits" | "withdrawals",
	fetchOpts?: RequestInit & { next?: { revalidate: number } },
): Promise<{ rows: (Deposit | Withdrawal)[]; tip: Tip | null }> {
	const rows: (Deposit | Withdrawal)[] = [];
	let cursor: string | null = null;
	let tip: Tip | null = null;
	let pages = 0;
	const seen = new Set<string>();
	// Tolerate a missing/erroring API (build-time prerender, unindexed self-host,
	// transient poll failure): return whatever we have rather than throwing.
	try {
		while (pages < PAGE_CAP) {
			const url = `${base}/${path}?limit=200${cursor ? `&cursor=${cursor}` : ""}`;
			const res = await fetch(url, fetchOpts);
			if (!res.ok) break;
			const body = (await res.json()) as DepositEnvelope | WithdrawalEnvelope;
			tip = body.tip;
			const arr =
				path === "deposits"
					? (body as DepositEnvelope).deposits
					: (body as WithdrawalEnvelope).withdrawals;
			rows.push(...arr);
			pages += 1;
			const nc = body.next_cursor;
			if (!nc || arr.length === 0 || seen.has(nc)) break;
			seen.add(nc);
			cursor = nc;
		}
	} catch {
		// fall through with partial/empty rows
	}
	rows.sort((a, b) => cursorHeight(b.cursor) - cursorHeight(a.cursor));
	return { rows, tip };
}
