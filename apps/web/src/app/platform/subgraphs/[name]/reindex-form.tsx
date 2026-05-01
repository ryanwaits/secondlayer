"use client";

import { useState } from "react";

interface SubgraphReindexFormProps {
	subgraphName: string;
	sessionToken: string;
}

export function SubgraphReindexForm({
	subgraphName,
	sessionToken,
}: SubgraphReindexFormProps) {
	const [tab, setTab] = useState<"backfill" | "reindex">("backfill");
	const [fromBlock, setFromBlock] = useState("");
	const [toBlock, setToBlock] = useState("");
	const [message, setMessage] = useState("");

	async function handleSubmit() {
		setMessage("");
		try {
			const res = await fetch(`/api/subgraphs/${subgraphName}/reindex`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({
					fromBlock: fromBlock ? Number(fromBlock) : undefined,
					toBlock: toBlock ? Number(toBlock) : undefined,
				}),
			});
			if (!res.ok) throw new Error(await res.text());
			setMessage(
				tab === "backfill"
					? "Backfill started successfully."
					: "Reindex started successfully.",
			);
		} catch (e) {
			setMessage(`Error: ${e instanceof Error ? e.message : "Unknown error"}`);
		}
	}

	return (
		<>
			<div className="sg-data-tabs">
				<button
					type="button"
					className={`sg-data-tab${tab === "backfill" ? " active" : ""}`}
					onClick={() => setTab("backfill")}
				>
					Backfill
				</button>
				<button
					type="button"
					className={`sg-data-tab${tab === "reindex" ? " active" : ""}`}
					onClick={() => setTab("reindex")}
				>
					Reindex
				</button>
			</div>

			{tab === "backfill" ? (
				<div className="sg-reindex-form">
					<p
						style={{
							fontSize: 13,
							color: "var(--text-muted)",
							lineHeight: 1.5,
							marginBottom: 16,
						}}
					>
						Fill in gaps where blocks were missed during syncing.
						Non-destructive &mdash; only processes blocks that have no data.
					</p>
					<div className="sg-reindex-fields">
						<div className="sg-reindex-field">
							<div className="sg-reindex-label">From block (optional)</div>
							<input
								className="sg-reindex-input"
								type="text"
								placeholder="e.g. 185000"
								value={fromBlock}
								onChange={(e) => setFromBlock(e.target.value)}
							/>
						</div>
						<div className="sg-reindex-field">
							<div className="sg-reindex-label">To block (optional)</div>
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
						onClick={handleSubmit}
					>
						Backfill gaps
					</button>
					{message && (
						<p
							style={{
								marginTop: 12,
								fontSize: 12,
								color: "var(--text-muted)",
							}}
						>
							{message}
						</p>
					)}
				</div>
			) : (
				<div className="sg-reindex-form">
					<div className="sg-reindex-warning">
						<svg
							aria-hidden="true"
							width="16"
							height="16"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							style={{ flexShrink: 0, marginTop: 1 }}
						>
							<path d="M8 1.5L1.5 13h13L8 1.5z" />
							<path d="M8 6v3" />
							<circle cx="8" cy="11" r="0.5" fill="currentColor" />
						</svg>
						<span>
							Reindexing is destructive. Existing data in the specified block
							range will be deleted and re-processed from the blockchain.
						</span>
					</div>
					<div className="sg-reindex-fields">
						<div className="sg-reindex-field">
							<div className="sg-reindex-label">From block (optional)</div>
							<input
								className="sg-reindex-input"
								type="text"
								placeholder="e.g. 187000"
								value={fromBlock}
								onChange={(e) => setFromBlock(e.target.value)}
							/>
						</div>
						<div className="sg-reindex-field">
							<div className="sg-reindex-label">To block (optional)</div>
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
						onClick={handleSubmit}
					>
						Reindex
					</button>
					{message && (
						<p
							style={{
								marginTop: 12,
								fontSize: 12,
								color: "var(--text-muted)",
							}}
						>
							{message}
						</p>
					)}
				</div>
			)}
		</>
	);
}
