"use client";

import { consoleFetch } from "@/lib/client-fetch";
import type { DeliveryRow } from "@/lib/types";
import { useEffect, useState } from "react";

/**
 * Evidence panel: four ov-style cards derived from the last 100 delivery
 * attempts (the same payload the delivery log polls) plus the subgraph's tip
 * lag resolved server-side. "Why isn't this landing" should be answerable
 * without leaving the page.
 */

export interface DeliveryStats {
	total: number;
	failed: number;
	/** The status code behind the plurality of ALL attempts, when there is one. */
	dominantCode: number | null;
	/** Share of all attempts that returned the dominant code (0–1). */
	dominantCodeShare: number;
	/** Consecutive failures at the head of the log (newest first). */
	streak: number;
	/** Longest run of consecutive failures among attempts dispatched today. */
	longestStreakToday: number;
	p50DurationMs: number | null;
	p95DurationMs: number | null;
	latest: DeliveryRow | null;
}

function isFailure(d: DeliveryRow): boolean {
	if (d.errorMessage) return true;
	if (d.statusCode === null) return true;
	return d.statusCode < 200 || d.statusCode >= 300;
}

function isToday(iso: string): boolean {
	const d = new Date(iso);
	const now = new Date();
	return (
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate()
	);
}

/**
 * Rows arrive newest-first. Exported so the reduction is testable without
 * standing up the component and its polling.
 */
export function summarizeDeliveries(rows: DeliveryRow[]): DeliveryStats {
	const failures = rows.filter(isFailure);

	// Dominant status across ALL attempts — "what does this endpoint usually
	// answer", not just what its failures look like.
	const codeCounts = new Map<number, number>();
	for (const d of rows) {
		if (d.statusCode === null) continue;
		codeCounts.set(d.statusCode, (codeCounts.get(d.statusCode) ?? 0) + 1);
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

	let longestStreakToday = 0;
	let run = 0;
	for (const d of rows) {
		if (isFailure(d) && isToday(d.dispatchedAt)) {
			run++;
			if (run > longestStreakToday) longestStreakToday = run;
		} else {
			run = 0;
		}
	}

	const durations = rows
		.map((d) => d.durationMs)
		.filter((ms): ms is number => ms != null)
		.sort((a, b) => a - b);

	return {
		total: rows.length,
		failed: failures.length,
		dominantCode,
		dominantCodeShare: rows.length > 0 ? dominantCount / rows.length : 0,
		streak,
		longestStreakToday,
		p50DurationMs:
			durations.length > 0 ? durations[Math.floor(durations.length / 2)] : null,
		p95DurationMs:
			durations.length > 0
				? durations[
						Math.min(durations.length - 1, Math.floor(durations.length * 0.95))
					]
				: null,
		latest: rows.find(isFailure) ?? null,
	};
}

function formatDuration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

export function Diagnostics({
	subscriptionId,
	subgraphName,
	sourceLag,
}: {
	subscriptionId: string;
	subgraphName: string;
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

	const latest = stats.latest;

	return (
		<>
			<div className="diag">
				{stats.dominantCode !== null && (
					<div className="ov-card">
						<div className="ov-card-label">Dominant status</div>
						<div className="ov-card-value">{stats.dominantCode}</div>
						<div className="ov-card-sub">
							{(stats.dominantCodeShare * 100).toFixed(1)}% of attempts
						</div>
					</div>
				)}
				<div className="ov-card">
					<div className="ov-card-label">Failure streak</div>
					<div className="ov-card-value">{stats.streak}</div>
					<div className="ov-card-sub">
						longest today: {stats.longestStreakToday}
					</div>
				</div>
				{stats.p50DurationMs !== null && (
					<div className="ov-card">
						<div className="ov-card-label">p50 duration</div>
						<div className="ov-card-value">
							{formatDuration(stats.p50DurationMs)}
						</div>
						{stats.p95DurationMs !== null && (
							<div className="ov-card-sub">
								p95 {formatDuration(stats.p95DurationMs)}
							</div>
						)}
					</div>
				)}
				{sourceLag && (
					<div className="ov-card">
						<div className="ov-card-label">Source lag</div>
						<div className="ov-card-value">
							{sourceLag.behind === 0 ? (
								"At tip"
							) : (
								<>
									{sourceLag.behind.toLocaleString()}
									<span className="unit">blocks</span>
								</>
							)}
						</div>
						<div className="ov-card-sub">
							{sourceLag.behind === 0
								? `${subgraphName} is at tip`
								: `${subgraphName} is at tip − ${sourceLag.behind.toLocaleString()}`}
						</div>
					</div>
				)}
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
