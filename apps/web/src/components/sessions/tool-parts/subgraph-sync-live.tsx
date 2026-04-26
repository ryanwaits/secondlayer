"use client";

import { useEffect, useState } from "react";

interface SyncSnapshot {
	status: string;
	mode?: "sync" | "reindex";
	lastProcessedBlock: number;
	chainTip: number;
	targetBlock?: number;
	progress: number;
	blocksRemaining: number;
	processedBlocks?: number;
	totalBlocks?: number;
	errorRate: number;
	totalProcessed: number;
	lastError: string | null;
}

interface SubgraphSyncLiveProps {
	name: string;
}

const POLL_MS = 2000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

/**
 * Polls GET /api/subgraphs/:name every 2s and renders a progress bar against
 * chain tip. Stops polling when the subgraph is caught up, when the user
 * leaves the card, or after 10 minutes. Sprint 3 has an SSE upgrade path if
 * polling feels laggy.
 */
export function SubgraphSyncLive({ name }: SubgraphSyncLiveProps) {
	const [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const startedAt = Date.now();

		async function tick() {
			try {
				const res = await fetch(`/api/subgraphs/${name}`, {
					credentials: "same-origin",
				});
				if (!res.ok) {
					setError(`HTTP ${res.status}`);
					return;
				}
				const data = (await res.json()) as {
					status: string;
					lastProcessedBlock: number;
					sync?: {
						chainTip: number;
						targetBlock?: number;
						progress: number;
						blocksRemaining: number;
						processedBlocks?: number;
						totalBlocks?: number;
						status: string;
						mode?: "sync" | "reindex";
					};
					health?: {
						errorRate: number;
						totalProcessed: number;
						lastError: string | null;
					};
				};
				if (cancelled) return;
				const snap: SyncSnapshot = {
					status: data.sync?.status ?? data.status,
					mode: data.sync?.mode,
					lastProcessedBlock: data.lastProcessedBlock,
					chainTip: data.sync?.chainTip ?? 0,
					targetBlock: data.sync?.targetBlock,
					progress: data.sync?.progress ?? 0,
					blocksRemaining: data.sync?.blocksRemaining ?? 0,
					processedBlocks: data.sync?.processedBlocks,
					totalBlocks: data.sync?.totalBlocks,
					errorRate: data.health?.errorRate ?? 0,
					totalProcessed: data.health?.totalProcessed ?? 0,
					lastError: data.health?.lastError ?? null,
				};
				setSnapshot(snap);
				if (snap.status === "synced" || snap.blocksRemaining <= 3) {
					setDone(true);
				}
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		}

		void tick();
		const interval = setInterval(() => {
			if (cancelled) return;
			if (done) {
				clearInterval(interval);
				return;
			}
			if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
				clearInterval(interval);
				setError("Sync tail timed out after 10 minutes");
				return;
			}
			void tick();
		}, POLL_MS);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [name, done]);

	return (
		<div className="tool-card">
			<div className="tool-card-header">
				Sync {name}
				{snapshot ? ` · ${snapshot.status}` : ""}
			</div>
			{snapshot ? (
				<div className="tool-status-row">
					<div className="tool-action-detail">
						<span className="tool-status-name">
							{snapshot.mode === "reindex" || snapshot.status === "reindexing"
								? `${snapshot.processedBlocks?.toLocaleString() ?? snapshot.lastProcessedBlock.toLocaleString()} / ${snapshot.totalBlocks?.toLocaleString() ?? (snapshot.targetBlock ?? snapshot.chainTip).toLocaleString()} blocks`
								: `${snapshot.lastProcessedBlock.toLocaleString()} / ${snapshot.chainTip.toLocaleString()}`}
						</span>
						<span className="tool-action-reason">
							{(snapshot.progress * 100).toFixed(1)}% ·{" "}
							{snapshot.blocksRemaining.toLocaleString()} blocks remaining ·{" "}
							{snapshot.totalProcessed.toLocaleString()} events indexed
						</span>
					</div>
				</div>
			) : (
				<div className="tool-status-row">
					<div className="tool-action-detail">
						<span className="tool-action-reason">Loading sync state…</span>
					</div>
				</div>
			)}
			{snapshot?.lastError && (
				<div className="tool-error-body">{snapshot.lastError}</div>
			)}
			{error && <div className="tool-error-body">{error}</div>}
		</div>
	);
}
