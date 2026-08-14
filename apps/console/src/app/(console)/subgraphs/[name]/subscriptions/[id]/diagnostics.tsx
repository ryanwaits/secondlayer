"use client";

import { consoleFetch } from "@/lib/client-fetch";
import type { DeliveryRow } from "@/lib/types";
import { useEffect, useState } from "react";

/**
 * Evidence panel. Everything here is derived from responses the page already
 * fetches — the last 100 delivery attempts plus the subscription detail — so
 * it adds no requests of its own. The point is that "why isn't this landing"
 * should be answerable without leaving the page.
 */

export interface DeliveryStats {
	total: number;
	failed: number;
	/** The status code behind the plurality of failures, when there is one. */
	dominantCode: number | null;
	dominantCodeShare: number;
	/** Consecutive failures at the head of the log (newest first). */
	streak: number;
	p50DurationMs: number | null;
	latest: DeliveryRow | null;
}

function isFailure(d: DeliveryRow): boolean {
	if (d.errorMessage) return true;
	if (d.statusCode === null) return true;
	return d.statusCode < 200 || d.statusCode >= 300;
}

/**
 * Rows arrive newest-first. Exported so the reduction is testable without
 * standing up the component and its polling.
 */
export function summarizeDeliveries(rows: DeliveryRow[]): DeliveryStats {
	const failures = rows.filter(isFailure);

	const codeCounts = new Map<number, number>();
	for (const f of failures) {
		if (f.statusCode === null) continue;
		codeCounts.set(f.statusCode, (codeCounts.get(f.statusCode) ?? 0) + 1);
	}
	let dominantCode: number | null = null;
	let dominantCount = 0;
	for (const [code, count] of codeCounts) {
		if (count > dominantCount) {
			dominantCode = code;
			dominantCount = count;
		}
	}

	let streak = 0;
	for (const d of rows) {
		if (!isFailure(d)) break;
		streak++;
	}

	const durations = rows
		.map((d) => d.durationMs)
		.filter((ms): ms is number => ms != null)
		.sort((a, b) => a - b);

	return {
		total: rows.length,
		failed: failures.length,
		dominantCode,
		dominantCodeShare:
			failures.length > 0 ? dominantCount / failures.length : 0,
		streak,
		p50DurationMs:
			durations.length > 0 ? durations[Math.floor(durations.length / 2)] : null,
		latest: rows.find(isFailure) ?? null,
	};
}

function formatDuration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function timeAgo(iso: string): string {
	const s = Math.max(
		0,
		Math.round((Date.now() - new Date(iso).getTime()) / 1000),
	);
	if (s < 60) return `${s}s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function Diagnostics({
	subscriptionId,
	circuitFailures,
	circuitOpenedAt,
	lastSuccessAt,
	timeoutMs,
	deadCount,
	sourceLag,
}: {
	subscriptionId: string;
	circuitFailures: number;
	circuitOpenedAt: string | null;
	lastSuccessAt: string | null;
	timeoutMs: number;
	deadCount: number;
	/** Blocks the subgraph is behind the chain tip, when the fetch succeeded. */
	sourceLag: { behind: number; tip: number } | null;
}) {
	const [stats, setStats] = useState<DeliveryStats | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function poll() {
			try {
				const res = await consoleFetch(
					`/api/subscriptions/${encodeURIComponent(subscriptionId)}/deliveries`,
				);
				if (!res.ok) return;
				const body = (await res.json()) as { data?: DeliveryRow[] };
				if (cancelled) return;
				setStats(summarizeDeliveries(body.data ?? []));
			} catch {
				// The delivery log below surfaces fetch errors; staying quiet here
				// avoids the same failure being reported twice on one page.
			}
		}
		void poll();
		const interval = setInterval(poll, 5_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [subscriptionId]);

	if (stats === null) {
		return <p className="detail-desc">Loading…</p>;
	}

	if (stats.total === 0) {
		return (
			<p className="detail-desc">
				Nothing delivered yet, so there's nothing to diagnose. Fire an event
				matching this subscription's filter to start collecting attempts.
			</p>
		);
	}

	if (stats.failed === 0 && deadCount === 0) {
		return (
			<p className="detail-desc">
				No failures in the last {stats.total} attempts. Nothing to diagnose.
			</p>
		);
	}

	const failRateTone = stats.failed / stats.total > 0.1 ? "bad" : "warn";
	const latest = stats.latest;

	return (
		<>
			<div className="sg-dx-strip">
				<span className={`sg-dx-chip ${failRateTone}`}>
					<b>{stats.failed}</b> of last {stats.total} failed
				</span>

				{stats.dominantCode !== null && (
					<span className="sg-dx-chip bad">
						{stats.dominantCodeShare >= 0.99 ? "all" : "mostly"}{" "}
						<b>{stats.dominantCode}</b>
					</span>
				)}

				{circuitOpenedAt ? (
					<span className="sg-dx-chip warn">
						<b>{circuitFailures}</b> consecutive · circuit open
					</span>
				) : (
					stats.streak > 1 && (
						<span className="sg-dx-chip warn">
							<b>{stats.streak}</b> consecutive
						</span>
					)
				)}

				{deadCount > 0 && (
					<span className="sg-dx-chip">
						<b>{deadCount}</b> dead {deadCount === 1 ? "row" : "rows"}
					</span>
				)}

				{stats.p50DurationMs !== null && (
					<span className="sg-dx-chip">
						p50 <b>{formatDuration(stats.p50DurationMs)}</b> of{" "}
						{formatDuration(timeoutMs)} timeout
					</span>
				)}

				{/* Answers "is the source even producing rows" — a delivery problem
				    and an indexing problem look identical from the log alone. */}
				{sourceLag && (
					<span
						className={`sg-dx-chip${sourceLag.behind > 100 ? " warn" : ""}`}
					>
						source{" "}
						{sourceLag.behind === 0 ? (
							<b>at tip</b>
						) : (
							<>
								<b>{sourceLag.behind.toLocaleString()}</b> blocks behind
							</>
						)}
					</span>
				)}

				<span className={`sg-dx-chip${lastSuccessAt ? " ok" : " bad"}`}>
					{lastSuccessAt ? (
						<>
							last success <b>{timeAgo(lastSuccessAt)}</b> ago
						</>
					) : (
						<b>never succeeded</b>
					)}
				</span>
			</div>

			{latest && (
				<div className="sg-dx-err">
					<div className="sg-dx-err-head">
						<span className="lbl">Last error</span>
						<span className="msg">
							{latest.errorMessage ?? `HTTP ${latest.statusCode}`}
						</span>
						<span className="when">
							attempt {latest.attempt} ·{" "}
							{new Date(latest.dispatchedAt).toLocaleTimeString()}
						</span>
					</div>
					{latest.responseBody && (
						// Full body, not the 80-char slice the delivery-log table shows.
						// The tail of an upstream error page is usually the useful part.
						<pre className="sg-dx-err-body">{latest.responseBody}</pre>
					)}
				</div>
			)}
		</>
	);
}
