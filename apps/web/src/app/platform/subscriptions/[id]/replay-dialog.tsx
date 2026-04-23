"use client";

import { useState } from "react";

/**
 * Replay modal — prompts for a block range, POSTs to
 * `/api/subscriptions/:id/replay`, shows the enqueued count. The emitter
 * drains replay outbox rows at 10% of batch capacity so the live stream
 * is never starved (see `LIVE_SHARE` in emitter.ts).
 */
export function ReplayDialog({ subscriptionId }: { subscriptionId: string }) {
	const [open, setOpen] = useState(false);
	const [fromBlock, setFromBlock] = useState("");
	const [toBlock, setToBlock] = useState("");
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<{
		enqueuedCount: number;
		scannedCount: number;
	} | null>(null);
	const [err, setErr] = useState<string | null>(null);

	async function onReplay() {
		setBusy(true);
		setErr(null);
		setResult(null);
		try {
			const res = await fetch(`/api/subscriptions/${subscriptionId}/replay`, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					fromBlock: Number(fromBlock),
					toBlock: Number(toBlock),
				}),
			});
			const body = (await res.json()) as {
				enqueuedCount?: number;
				scannedCount?: number;
				error?: string;
			};
			if (!res.ok) {
				setErr(body.error ?? `HTTP ${res.status}`);
				return;
			}
			setResult({
				enqueuedCount: body.enqueuedCount ?? 0,
				scannedCount: body.scannedCount ?? 0,
			});
		} finally {
			setBusy(false);
		}
	}

	if (!open) {
		return (
			<button
				type="button"
				className="btn-secondary"
				onClick={() => setOpen(true)}
			>
				Replay range
			</button>
		);
	}

	return (
		<div className="detail-section">
			<h3>Replay block range</h3>
			<p className="detail-desc">
				Re-emit rows from this subgraph table in the given block range.
				Replays drain at 10% of batch capacity so live deliveries aren't
				starved. Receivers must be idempotent — dedup on the `webhook-id`
				header.
			</p>
			<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
				<label className="form-field" style={{ flex: 1 }}>
					<span>From block</span>
					<input
						type="number"
						min="0"
						value={fromBlock}
						onChange={(e) => setFromBlock(e.target.value)}
					/>
				</label>
				<label className="form-field" style={{ flex: 1 }}>
					<span>To block</span>
					<input
						type="number"
						min="0"
						value={toBlock}
						onChange={(e) => setToBlock(e.target.value)}
					/>
				</label>
			</div>
			{err && <p style={{ color: "var(--error)", marginTop: 8 }}>{err}</p>}
			{result && (
				<p style={{ color: "var(--success)", marginTop: 8 }}>
					Enqueued {result.enqueuedCount} of {result.scannedCount} scanned rows.
				</p>
			)}
			<div style={{ marginTop: 12, display: "flex", gap: 8 }}>
				<button
					type="button"
					className="btn-primary"
					disabled={busy || !fromBlock || !toBlock}
					onClick={onReplay}
				>
					{busy ? "Enqueuing…" : "Enqueue replay"}
				</button>
				<button
					type="button"
					className="btn-secondary"
					onClick={() => {
						setOpen(false);
						setResult(null);
						setErr(null);
					}}
				>
					Close
				</button>
			</div>
		</div>
	);
}
