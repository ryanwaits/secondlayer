import { CopyButton } from "@/components/copy-button";
import { PLATFORM_API_URL } from "@/lib/api";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = socialMeta({
	title: "sBTC Peg Explorer | secondlayer",
	description:
		"Etherscan for the sBTC bridge — live peg-in deposits and peg-out withdrawals with lifecycle status, built only on the keyless /v1/index/sbtc/* API. No key required.",
	image: "/og/index.png",
	path: "/sbtc",
});

export const revalidate = 30;

const API = PLATFORM_API_URL;
const SBTC = `${API}/v1/index/sbtc`;

// ── Wire shapes (real /v1/index/sbtc/* responses) ──────────────────────

interface Tip {
	block_height: number;
	finalized_height: number;
	lag_seconds: number;
}

interface Deposit {
	cursor: string;
	block_height: number;
	block_time: string;
	tx_id: string;
	amount: string; // sats
	bitcoin_txid: string; // 0x-prefixed
}

interface Withdrawal {
	cursor: string;
	request_id: number;
	status: "REQUESTED" | "ACCEPTED" | "REJECTED";
	amount: string; // sats
	sender: string;
	sweep_txid: string | null; // 0x-prefixed, present once accepted
	requested_at: string;
	resolved_at: string | null;
}

interface DepositEnvelope {
	deposits: Deposit[];
	next_cursor: string | null;
	tip: Tip;
}

interface WithdrawalEnvelope {
	withdrawals: Withdrawal[];
	next_cursor: string | null;
	tip: Tip;
}

// ── Fetch helpers — paginate the full feed (it's small) server-side ─────

const PAGE_CAP = 20; // safety bound; the indexed peg feed is a few hundred rows

async function fetchAll<T extends DepositEnvelope | WithdrawalEnvelope>(
	path: "deposits" | "withdrawals",
): Promise<{
	rows: (Deposit | Withdrawal)[];
	tip: Tip | null;
	partial: boolean;
}> {
	const rows: (Deposit | Withdrawal)[] = [];
	let cursor: string | null = null;
	let tip: Tip | null = null;
	let pages = 0;
	const seen = new Set<string>();
	try {
		while (pages < PAGE_CAP) {
			const url = `${SBTC}/${path}?limit=200${cursor ? `&cursor=${cursor}` : ""}`;
			const res = await fetch(url, { next: { revalidate: 30 } });
			if (!res.ok) break;
			const body = (await res.json()) as T;
			tip = body.tip;
			const arr =
				path === "deposits"
					? (body as DepositEnvelope).deposits
					: (body as WithdrawalEnvelope).withdrawals;
			rows.push(...arr);
			pages += 1;
			const nc = body.next_cursor;
			if (!nc || arr.length === 0 || seen.has(nc)) {
				return { rows, tip, partial: false };
			}
			seen.add(nc);
			cursor = nc;
		}
		// Hit the page cap with more to fetch — totals are a floor, not exact.
		return { rows, tip, partial: true };
	} catch {
		return { rows, tip, partial: false };
	}
}

// ── Formatting ─────────────────────────────────────────────────────────

const num = new Intl.NumberFormat("en-US");

/** sats (string) → BTC, up to 8 dp, trailing zeros trimmed. */
function btc(sats: string | number, dp = 8): string {
	const n = Number(sats) / 1e8;
	return n.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: dp,
	});
}

function trunc(hex: string, head = 8, tail = 6): string {
	const h = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (h.length <= head + tail) return hex;
	return `${hex.startsWith("0x") ? "0x" : ""}${h.slice(0, head)}…${h.slice(-tail)}`;
}

function truncAddr(addr: string): string {
	if (addr.length <= 14) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-5)}`;
}

/** mempool.space wants raw hex, no 0x prefix. */
const mempoolTx = (txid: string) =>
	`https://mempool.space/tx/${txid.startsWith("0x") ? txid.slice(2) : txid}`;
const stacksTx = (txid: string) => `https://explorer.hiro.so/txid/${txid}`;

function ago(iso: string): string {
	const then = new Date(iso).getTime();
	const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
	if (secs < 90) return `${secs}s ago`;
	const mins = Math.round(secs / 60);
	if (mins < 90) return `${mins}m ago`;
	const hrs = Math.round(mins / 60);
	if (hrs < 36) return `${hrs}h ago`;
	return `${Math.round(hrs / 24)}d ago`;
}

function StatusBadge({ status }: { status: string }) {
	const k = status.toLowerCase();
	return <span className={`peg-badge peg-badge-${k}`}>{status}</span>;
}

// ── Page ───────────────────────────────────────────────────────────────

export default async function SbtcPegPage() {
	const [dep, wd] = await Promise.all([
		fetchAll<DepositEnvelope>("deposits"),
		fetchAll<WithdrawalEnvelope>("withdrawals"),
	]);

	const deposits = dep.rows as Deposit[];
	const withdrawals = wd.rows as Withdrawal[];
	const tip = dep.tip ?? wd.tip;

	const depSats = deposits.reduce((s, d) => s + Number(d.amount), 0);
	const acceptedSats = withdrawals
		.filter((w) => w.status === "ACCEPTED")
		.reduce((s, w) => s + Number(w.amount), 0);
	const netSats = depSats - acceptedSats;

	const statusCounts = withdrawals.reduce<Record<string, number>>((m, w) => {
		m[w.status] = (m[w.status] ?? 0) + 1;
		return m;
	}, {});

	// Freshness = how far our index trails realtime (lag_seconds), NOT the
	// tip↔finalized gap (that's the protocol's ~24h finalization depth, normal).
	const lag = tip?.lag_seconds ?? null;
	const fresh = lag !== null && lag < 180;

	// Most-recent-first for the tables.
	const recentDeposits = [...deposits]
		.sort((a, b) => b.block_height - a.block_height)
		.slice(0, 25);
	const recentWithdrawals = [...withdrawals]
		.sort(
			(a, b) =>
				new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime(),
		)
		.slice(0, 25);

	const empty = deposits.length === 0 && withdrawals.length === 0;

	return (
		<main className="explore-wrap peg-wrap">
			<nav className="explore-crumb" aria-label="Breadcrumb">
				<Link href="/subgraphs/explore">Explore</Link>
				<span>/</span>sBTC Peg
			</nav>

			<section className="explore-hero">
				<h1>sBTC Peg Explorer</h1>
				<p>
					Etherscan for the sBTC bridge — every peg-in and peg-out, decoded with
					full lifecycle status and Bitcoin&nbsp;↔&nbsp;Stacks correlation.
					Nothing here runs a node or holds a key: the whole page is built on
					the keyless <code className="peg-code">/v1/index/sbtc/*</code> API.
				</p>
			</section>

			{/* 1 — SUMMARY STRIP */}
			<section className="peg-stats" aria-label="Peg scoreboard">
				<div className="peg-stat">
					<span className="peg-stat-label">Peg-in deposits</span>
					<span className="peg-stat-val">{num.format(deposits.length)}</span>
					<span className="peg-stat-sub">{btc(depSats, 4)} BTC in</span>
				</div>
				<div className="peg-stat">
					<span className="peg-stat-label">Peg-out withdrawals</span>
					<span className="peg-stat-val">{num.format(withdrawals.length)}</span>
					<span className="peg-stat-sub">
						{statusCounts.ACCEPTED ?? 0} accepted · {statusCounts.REJECTED ?? 0}{" "}
						rejected · {statusCounts.REQUESTED ?? 0} open
					</span>
				</div>
				<div className="peg-stat">
					<span className="peg-stat-label">Net peg flow</span>
					<span className="peg-stat-val">{btc(netSats, 4)}</span>
					<span className="peg-stat-sub">BTC in − accepted out</span>
				</div>
				<div className="peg-stat">
					<span className="peg-stat-label">Chain tip</span>
					<span className="peg-stat-val">
						{tip ? `#${num.format(tip.block_height)}` : "—"}
					</span>
					<span className="peg-stat-sub">
						<span
							className={`explore-dot${fresh ? "" : " lag"}`}
							aria-hidden="true"
						/>
						{lag === null
							? "unavailable"
							: fresh
								? `synced · ${lag}s behind tip`
								: `${lag}s behind tip`}
					</span>
				</div>
			</section>

			{(dep.partial || wd.partial) && (
				<p className="peg-note">
					Totals reflect the most recent {PAGE_CAP * 200}+ indexed peg events.
				</p>
			)}

			{/* keyless proof */}
			<div className="explore-machine peg-machine">
				<div className="explore-machine-head">
					<span className="t">No API key required — try it</span>
					<CopyButton code={`curl ${SBTC}/deposits`} />
				</div>
				<pre>
					<span className="c">
						# every sBTC peg-in, decoded — no key, no account
					</span>
					{"\n"}
					<span className="m">curl</span> {SBTC}/deposits
				</pre>
			</div>

			{empty ? (
				<section className="peg-empty">
					<h2>No peg activity indexed yet</h2>
					<p>
						The feed is live but no deposits or withdrawals are in range right
						now. This page renders straight from the keyless API the moment rows
						land.
					</p>
				</section>
			) : (
				<>
					{/* 2 — DEPOSITS */}
					<section className="peg-sect">
						<h2>Recent deposits</h2>
						<span className="peg-sect-meta">
							peg-in · BTC&nbsp;→&nbsp;sBTC · all confirmed
						</span>
					</section>
					<div className="peg-tbl-wrap">
						<table className="peg-tbl">
							<thead>
								<tr>
									<th>Amount</th>
									<th>Bitcoin tx</th>
									<th>Stacks tx</th>
									<th className="peg-num">Block</th>
									<th>Status</th>
									<th className="peg-when">When</th>
								</tr>
							</thead>
							<tbody>
								{recentDeposits.map((d) => (
									<tr key={d.cursor}>
										<td className="peg-amt">{btc(d.amount)} BTC</td>
										<td>
											<a
												className="peg-link"
												href={mempoolTx(d.bitcoin_txid)}
												target="_blank"
												rel="noreferrer"
											>
												{trunc(d.bitcoin_txid)}
											</a>
										</td>
										<td>
											<a
												className="peg-link peg-link-dim"
												href={stacksTx(d.tx_id)}
												target="_blank"
												rel="noreferrer"
											>
												{trunc(d.tx_id)}
											</a>
										</td>
										<td className="peg-num">{num.format(d.block_height)}</td>
										<td>
											<StatusBadge status="COMPLETED" />
										</td>
										<td className="peg-when">{ago(d.block_time)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* 3 — WITHDRAWALS */}
					<section className="peg-sect">
						<h2>Recent withdrawals</h2>
						<span className="peg-sect-meta">
							peg-out · sBTC&nbsp;→&nbsp;BTC · lifecycle tracked
						</span>
					</section>
					<div className="peg-tbl-wrap">
						<table className="peg-tbl">
							<thead>
								<tr>
									<th className="peg-num">Request</th>
									<th>Sender</th>
									<th>Amount</th>
									<th>Status</th>
									<th>BTC sweep</th>
									<th className="peg-when">When</th>
								</tr>
							</thead>
							<tbody>
								{recentWithdrawals.map((w) => (
									<tr key={w.cursor}>
										<td className="peg-num peg-req">#{w.request_id}</td>
										<td>
											<a
												className="peg-link peg-link-dim"
												href={`https://explorer.hiro.so/address/${w.sender}`}
												target="_blank"
												rel="noreferrer"
											>
												{truncAddr(w.sender)}
											</a>
										</td>
										<td className="peg-amt">{btc(w.amount)} BTC</td>
										<td>
											<StatusBadge status={w.status} />
										</td>
										<td>
											{w.sweep_txid ? (
												<a
													className="peg-link"
													href={mempoolTx(w.sweep_txid)}
													target="_blank"
													rel="noreferrer"
												>
													{trunc(w.sweep_txid)}
												</a>
											) : (
												<span className="peg-dash">—</span>
											)}
										</td>
										<td className="peg-when">{ago(w.requested_at)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}

			{/* machine access / story footer */}
			<div className="peg-foot">
				<span className="peg-foot-lead">Built on the keyless API.</span>
				<p>
					Deposits, withdrawals, and full per-request lifecycle are decoded sBTC
					peg data Hiro declined to maintain — served reorg-aware,
					cursor-paginated, and signed, with no key. The page above is the
					proof.
				</p>
				<div className="peg-foot-eps">
					{[
						"GET /v1/index/sbtc/deposits",
						"GET /v1/index/sbtc/withdrawals",
						"GET /v1/index/sbtc/withdrawals/:request_id",
						"GET /v1/index/sbtc/events",
					].map((ep) => (
						<code key={ep} className="peg-foot-ep">
							{ep}
						</code>
					))}
				</div>
				<Link href="/docs/index" className="peg-foot-link">
					Read the Index docs →
				</Link>
			</div>
		</main>
	);
}
