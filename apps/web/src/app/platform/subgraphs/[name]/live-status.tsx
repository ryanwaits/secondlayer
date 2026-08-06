"use client";

import { LivePill } from "@/components/console/live-pill";
import { getDisplayStatus } from "@/lib/intelligence/subgraphs";
import type { SubgraphDetail, SubgraphOperation } from "@/lib/types";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import {
	readDismissedOperationIds,
	readOperationSource,
	readReportedOperationIds,
	rememberOperationDismissed,
	rememberOperationReported,
} from "./operation-memory";
import {
	formatDuration,
	formatDurationMs,
	operationDurationMs,
	operationLabel,
	operationPercent,
	operationPillState,
	operationRange,
	selectDisplayOperation,
	shouldReportTerminal,
	terminalAnalyticsEvent,
} from "./operation-status";

function formatBlock(block: number | null | undefined): string {
	return block == null ? "—" : block.toLocaleString();
}

/**
 * Floating status pill for a subgraph's detail page. Polls `/api/subgraphs/:name`
 * and `/api/subgraphs/:name/operations` every 5s so the pill (and its ETA)
 * update live instead of requiring a manual page reload — mirrors
 * `DeliveryLog`'s poll pattern.
 *
 * The operations poll is what makes backfill/reindex legible: a backfill never
 * touches `subgraphs.status` (only reindex does), so keying the pill on the
 * subgraph row alone left it reading "Live" for the entire run. Polling
 * independently of the form also means a job started from the CLI — or one
 * still running after a reload — shows up just the same.
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
	const [operations, setOperations] = useState<SubgraphOperation[]>([]);
	const [dismissedOpIds, setDismissedOpIds] = useState<ReadonlySet<string>>(
		() => new Set<string>(),
	);

	// Storage is read after mount, never during render — the server has no
	// localStorage, and reading it inline would hydrate-mismatch.
	useEffect(() => {
		setDismissedOpIds(readDismissedOperationIds());
	}, []);

	useEffect(() => {
		let cancelled = false;

		async function pollDetail() {
			try {
				const res = await fetch(`/api/subgraphs/${name}`, {
					credentials: "same-origin",
				});
				if (cancelled || !res.ok) return;
				setSubgraph((await res.json()) as SubgraphDetail);
			} catch {
				// Transient poll failure — keep showing the last-known state.
			}
		}

		async function pollOperations() {
			try {
				const res = await fetch(`/api/subgraphs/${name}/operations`, {
					credentials: "same-origin",
				});
				if (cancelled || !res.ok) return;
				const body = (await res.json()) as { operations?: SubgraphOperation[] };
				setOperations(body.operations ?? []);
			} catch {
				// Same — a dropped poll must not clear a job that is still running.
			}
		}

		function poll() {
			// Independent so one failing surface can't blank the other.
			void pollDetail();
			void pollOperations();
		}

		// Immediately, then on the interval: operations aren't server-rendered,
		// so without this an in-flight job stays invisible for the first 5s.
		poll();
		const interval = setInterval(poll, 5_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [name]);

	const chainTip = subgraph.sync.chainTip;
	const sourceChainTip = subgraph.sync.sourceChainTip ?? chainTip;
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

	const opDisplay = selectDisplayOperation(operations, { dismissedOpIds });

	// Terminal analytics fire here rather than in the submit form: this is the
	// component that observes the transition, and it observes it for jobs the
	// form never started. `duration_ms` comes off the operation's own
	// timestamps, so it stays correct across a reload.
	useEffect(() => {
		if (operations.length === 0) return;
		const reported = readReportedOperationIds();
		const now = Date.now();
		for (const op of operations) {
			if (!shouldReportTerminal(op, reported, now)) continue;
			const { event, properties } = terminalAnalyticsEvent(
				op,
				readOperationSource(op.id),
				sourceChainTip,
			);
			posthog.capture(event, properties);
			rememberOperationReported(op.id);
			reported.add(op.id);
		}
	}, [operations, sourceChainTip]);

	function dismissOperation(id: string) {
		rememberOperationDismissed(id);
		setDismissedOpIds((prev) => new Set(prev).add(id));
	}

	const isError = displayStatus === "error" || displayStatus === "stalled";
	const inProgress =
		displayStatus === "syncing" || displayStatus === "reindexing";

	if (opDisplay && !isError) {
		const { op } = opDisplay;
		const label = operationLabel(op);
		const percent = operationPercent(op);
		const range = operationRange(op, sourceChainTip);
		const pillState = operationPillState(opDisplay);
		const isActive = opDisplay.phase === "active";
		const durationMs = operationDurationMs(op);
		const rangeValue = `${formatBlock(range.fromBlock)} → ${formatBlock(
			range.toBlock,
		)}${range.toIsTip ? " (tip)" : ""}`;

		return (
			<LivePill
				state={pillState}
				label={isActive && percent != null ? `${label} · ${percent}%` : label}
			>
				<div className="lp-h">
					<span
						className={`lp-dot ${
							pillState === "live"
								? "green"
								: pillState === "error"
									? "red"
									: "blue"
						}`}
					/>
					<b>{name}</b> · {label}
				</div>

				{isActive && percent != null && (
					<div className="lp-bar">
						<i style={{ width: `${percent}%` }} />
					</div>
				)}

				<div className="lp-stat">
					<span className="k">Range</span>
					<span className="v">{rangeValue}</span>
				</div>

				{isActive ? (
					op.status === "queued" ? (
						<div className="lp-stat">
							<span className="k">Queue</span>
							<span className="v">
								{op.queuePosition != null
									? `position ${op.queuePosition}`
									: "waiting"}
							</span>
						</div>
					) : (
						<div className="lp-stat">
							<span className="k">Progress</span>
							<span className="v">
								{percent != null ? `${percent}%` : "—"}
								{etaSeconds != null && ` · ~${formatDuration(etaSeconds)} left`}
							</span>
						</div>
					)
				) : (
					<div className="lp-stat">
						<span className="k">Duration</span>
						<span className="v">
							{durationMs != null ? formatDurationMs(durationMs) : "—"}
						</span>
					</div>
				)}

				<div className="lp-stat">
					<span className="k">Rows indexed</span>
					<span className="v">{totalRows.toLocaleString()}</span>
				</div>

				{!isActive && op.status !== "completed" && op.error && (
					<div className="lp-err" style={{ marginTop: 8, marginBottom: 0 }}>
						{op.error}
					</div>
				)}

				{!isActive && (
					<button
						type="button"
						className="lp-dismiss"
						onClick={() => dismissOperation(op.id)}
					>
						Dismiss
					</button>
				)}
			</LivePill>
		);
	}

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
