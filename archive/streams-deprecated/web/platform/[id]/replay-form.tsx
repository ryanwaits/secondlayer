"use client";

import { useCallback, useState } from "react";

export function ReplayForm({ streamId }: { streamId: string }) {
	const [fromBlock, setFromBlock] = useState("");
	const [toBlock, setToBlock] = useState("");
	const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
	const [error, setError] = useState<string | null>(null);

	const handleReplay = useCallback(async () => {
		if (!fromBlock || !toBlock) return;
		setStatus("loading");
		setError(null);
		try {
			const res = await fetch(`/api/streams/${streamId}/replay`, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					fromBlock: Number(fromBlock),
					toBlock: Number(toBlock),
				}),
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || "Replay failed");
			}
			setStatus("done");
			setTimeout(() => setStatus("idle"), 3000);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Replay failed");
			setStatus("error");
		}
	}, [streamId, fromBlock, toBlock]);

	return (
		<div className="sg-reindex-form">
			<p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 16 }}>
				Replay deliveries for a specific block range. Max 10,000 blocks per replay.
			</p>
			<div className="sg-reindex-fields">
				<div className="sg-reindex-field">
					<div className="sg-reindex-label">Start block</div>
					<input
						className="sg-reindex-input"
						type="text"
						placeholder="e.g. 187000"
						value={fromBlock}
						onChange={(e) => setFromBlock(e.target.value)}
					/>
				</div>
				<div className="sg-reindex-field">
					<div className="sg-reindex-label">End block</div>
					<input
						className="sg-reindex-input"
						type="text"
						placeholder="e.g. 187421"
						value={toBlock}
						onChange={(e) => setToBlock(e.target.value)}
					/>
				</div>
			</div>
			<button
				type="button"
				className="sg-reindex-btn"
				style={{ background: "var(--accent)" }}
				onClick={handleReplay}
				disabled={status === "loading" || !fromBlock || !toBlock}
			>
				{status === "loading" ? "Replaying..." : status === "done" ? "Queued!" : "Replay blocks"}
			</button>
			{error && (
				<p style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>{error}</p>
			)}
		</div>
	);
}
