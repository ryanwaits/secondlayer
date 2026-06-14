import { CopyButton } from "@/components/copy-button";
import { PLATFORM_API_URL } from "@/lib/api";
import { socialMeta } from "@/lib/og";
import type { Metadata } from "next";
import Link from "next/link";
import { LivePegTables } from "./live-peg-tables";
import {
	type Deposit,
	PUBLIC_SBTC,
	type SummaryEnvelope,
	type Tip,
	type Withdrawal,
	btc,
	fetchWindow,
	num,
} from "./shared";

export const metadata: Metadata = socialMeta({
	title: "sBTC Peg Explorer | secondlayer",
	description:
		"Etherscan for the sBTC bridge — live peg-in deposits and peg-out withdrawals with lifecycle status, built only on the keyless /v1/index/sbtc/* API. No key required.",
	image: "/og/index.png",
	path: "/sbtc",
});

export const revalidate = 30;

const SBTC = `${PLATFORM_API_URL}/v1/index/sbtc`;
const MAX_ROWS = 25;

async function fetchSummary(): Promise<SummaryEnvelope | null> {
	try {
		const res = await fetch(`${SBTC}/summary`, { next: { revalidate: 30 } });
		if (!res.ok) return null;
		return (await res.json()) as SummaryEnvelope;
	} catch {
		return null;
	}
}

export default async function SbtcPegPage() {
	const [summaryEnv, dep, wd] = await Promise.all([
		fetchSummary(),
		fetchWindow(SBTC, "deposits", { next: { revalidate: 30 } }),
		fetchWindow(SBTC, "withdrawals", { next: { revalidate: 30 } }),
	]);

	const summary = summaryEnv?.summary ?? null;
	const tip: Tip | null = summaryEnv?.tip ?? dep.tip ?? wd.tip;

	const initialDeposits = (dep.rows as Deposit[]).slice(0, MAX_ROWS);
	const initialWithdrawals = (wd.rows as Withdrawal[]).slice(0, MAX_ROWS);
	const empty = initialDeposits.length === 0 && initialWithdrawals.length === 0;

	// Freshness from lag_seconds (index vs realtime), NOT the tip↔finalized gap
	// (that's the protocol's ~24h finalization depth, normal).
	const lag = tip?.lag_seconds ?? null;
	const fresh = lag !== null && lag < 180;

	const wOpen = summary
		? summary.total_withdrawals_requested -
			summary.total_withdrawals_accepted -
			summary.total_withdrawals_rejected
		: 0;

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

			{/* 1 — SUMMARY STRIP (all-time, from /summary) */}
			<section className="peg-stats" aria-label="Peg scoreboard">
				<div className="peg-stat">
					<span className="peg-stat-label">Peg-in deposits</span>
					<span className="peg-stat-val">
						{summary ? num.format(summary.total_deposits) : "—"}
					</span>
					<span className="peg-stat-sub">all-time</span>
				</div>
				<div className="peg-stat">
					<span className="peg-stat-label">Peg-out withdrawals</span>
					<span className="peg-stat-val">
						{summary ? num.format(summary.total_withdrawals_requested) : "—"}
					</span>
					<span className="peg-stat-sub">
						{summary
							? `${summary.total_withdrawals_accepted} accepted · ${summary.total_withdrawals_rejected} rejected · ${wOpen} open`
							: "all-time"}
					</span>
				</div>
				<div className="peg-stat">
					<span className="peg-stat-label">Net peg flow</span>
					<span className="peg-stat-val">
						{summary ? btc(summary.net_peg_flow_sats, 4) : "—"}
					</span>
					<span className="peg-stat-sub">BTC locked (in − out)</span>
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

			{/* keyless proof */}
			<div className="explore-machine peg-machine">
				<div className="explore-machine-head">
					<span className="t">No API key required — try it</span>
					<CopyButton code={`curl ${PUBLIC_SBTC}/deposits`} />
				</div>
				<pre>
					<span className="c">
						# every sBTC peg-in, decoded — no key, no account
					</span>
					{"\n"}
					<span className="m">curl</span> {PUBLIC_SBTC}/deposits
				</pre>
			</div>

			{empty ? (
				<section className="peg-empty">
					<h2>No peg activity indexed yet</h2>
					<p>
						The feed is live but no deposits or withdrawals are in the recent
						window right now. This page renders straight from the keyless API
						the moment rows land.
					</p>
				</section>
			) : (
				<LivePegTables
					initialDeposits={initialDeposits}
					initialWithdrawals={initialWithdrawals}
					serverNow={Date.now()}
				/>
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
						"GET /v1/index/sbtc/summary",
						"GET /v1/index/sbtc/deposits",
						"GET /v1/index/sbtc/withdrawals",
						"GET /v1/index/sbtc/withdrawals/:request_id",
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
