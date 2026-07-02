"use client";

import { LivePill } from "@/components/console/live-pill";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import type { SubgraphDetail } from "@/lib/types";
import { useEffect, useState } from "react";

function formatDuration(seconds: number): string {
	if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
	if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
	return `${(seconds / 3600).toFixed(1)}h`;
}

/**
 * Floating status pill for a subgraph's detail page. Polls `/api/subgraphs/:name`
 * every 5s while reindexing/syncing so the pill (and its ETA) update live instead
 * of requiring a manual page reload — mirrors `DeliveryLog`'s poll pattern.
 */
export function SubgraphLiveStatus({
	name,
	initial,
	subsCount,
}: {
	name: string;
	initial: SubgraphDetail;
	subsCount: number;
}) {
	const [subgraph, setSubgraph] = useState<SubgraphDetail>(initial);

	useEffect(() => {
		let cancelled = false;
		async function poll() {
			try {
				const res = await fetch(`/api/subgraphs/${name}`, {
					credentials: "same-origin",
				});
				if (cancelled || !res.ok) return;
				const body = (await res.json()) as SubgraphDetail;
				setSubgraph(body);
			} catch {
				// Transient poll failure — keep showing the last-known state.
			}
		}
		const interval = setInterval(poll, 5_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [name]);

	const chainTip = subgraph.sync.chainTip;
	// Same call shape as the page's static badge (getDisplayStatus's 2nd arg is
	// `lastProcessedBlock`, not chainTip) — kept identical to avoid a display
	// discrepancy between the static badge and this pill.
	const displayStatus = getDisplayStatus(
		{
			...subgraph,
			totalProcessed: subgraph.health.totalProcessed,
			totalErrors: subgraph.health.totalErrors,
			tables: Object.keys(subgraph.tables),
			createdAt: "",
		},
		subgraph.lastProcessedBlock,
	);
	const { totalProcessed, totalErrors } = subgraph.health;
	const successRate =
		totalProcessed > 0
			? ((totalProcessed - totalErrors) / totalProcessed) * 100
			: null;
	const { blocksRemaining, etaSeconds } = subgraph.sync;
	const totalRows = Object.values(subgraph.tables).reduce(
		(sum, t) => sum + t.rowCount,
		0,
	);
	const syncProgress =
		chainTip && subgraph.lastProcessedBlock
			? Math.min(
					Math.round((subgraph.lastProcessedBlock / chainTip) * 100),
					100,
				)
			: 0;
	const isError = displayStatus === "error" || displayStatus === "stalled";
	const inProgress =
		displayStatus === "syncing" || displayStatus === "reindexing";
	const badgeLbl = isError
		? "Error"
		: displayStatus === "reindexing"
			? "Reindexing"
			: displayStatus === "syncing"
				? "Syncing"
				: "Live";
	const pillState = isError ? "error" : inProgress ? "reindexing" : "live";
	const pillLabel = inProgress ? `${badgeLbl} · ${syncProgress}%` : badgeLbl;

	return (
		<LivePill state={pillState} label={pillLabel}>
			{pillState === "error" ? (
				<>
					<div className="lp-h">
						<span className="lp-dot red" />
						<b>{name}</b> · Error
					</div>
					<div className="lp-err">
						{subgraph.health.lastError || "Indexing error"}
					</div>
					{subgraph.lastProcessedBlock && (
						<div className="lp-err-meta">
							block {subgraph.lastProcessedBlock.toLocaleString()}
						</div>
					)}
				</>
			) : pillState === "reindexing" ? (
				<>
					<div className="lp-h">
						<span className="lp-dot blue" />
						<b>{name}</b> · {badgeLbl}
					</div>
					<div className="lp-bar">
						<i style={{ width: `${syncProgress}%` }} />
					</div>
					<div className="lp-sub">
						{subgraph.lastProcessedBlock
							? subgraph.lastProcessedBlock.toLocaleString()
							: "—"}{" "}
						/ {chainTip ? chainTip.toLocaleString() : "—"}
						{etaSeconds != null && <> · est {formatDuration(etaSeconds)}</>}
						<br />
						{blocksRemaining.toLocaleString()} blocks behind
					</div>
				</>
			) : (
				<>
					<div className="lp-h">
						<span className="lp-dot green" />
						<b>{name}</b> · Live
					</div>
					<div className="lp-stat">
						<span className="k">Success rate</span>
						<span className="v ok">
							{successRate !== null ? `${successRate.toFixed(1)}%` : "—"}
						</span>
					</div>
					<div className="lp-stat">
						<span className="k">Rows indexed</span>
						<span className="v">{totalRows.toLocaleString()}</span>
					</div>
					<div className="lp-stat">
						<span className="k">Last block</span>
						<span className="v">
							{subgraph.lastProcessedBlock
								? subgraph.lastProcessedBlock.toLocaleString()
								: "—"}
						</span>
					</div>
					<div className="lp-stat">
						<span className="k">Subscriptions</span>
						<span className="v">{subsCount}</span>
					</div>
				</>
			)}
		</LivePill>
	);
}
