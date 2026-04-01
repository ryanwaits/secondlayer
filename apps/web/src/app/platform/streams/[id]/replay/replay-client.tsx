"use client";

import { useBreadcrumbOverrides } from "@/lib/breadcrumb";
import type { Stream } from "@/lib/types";
import { useEffect, useState } from "react";

export function ReplayClient({ stream }: { stream: Stream }) {
	const { set: setBreadcrumb } = useBreadcrumbOverrides();
	useEffect(() => {
		setBreadcrumb(`/streams/${stream.id}`, stream.name);
	}, [stream.id, stream.name, setBreadcrumb]);

	const [fromBlock, setFromBlock] = useState("");
	const [toBlock, setToBlock] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	const blockCount =
		fromBlock && toBlock
			? Math.max(0, Number(toBlock) - Number(fromBlock) + 1)
			: 0;

	const handleReplay = async () => {
		if (!fromBlock || !toBlock) return;
		setLoading(true);
		setMessage(null);
		try {
			const res = await fetch(`/api/streams/${stream.id}/replay`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					fromBlock: Number(fromBlock),
					toBlock: Number(toBlock),
				}),
			});
			const data = await res.json();
			if (!res.ok) {
				setMessage({ type: "error", text: data.error || "Replay failed" });
			} else {
				setMessage({
					type: "success",
					text: `Queued ${data.jobCount} jobs for blocks ${data.fromBlock.toLocaleString()}\u2013${data.toBlock.toLocaleString()}`,
				});
			}
		} catch {
			setMessage({ type: "error", text: "Network error" });
		} finally {
			setLoading(false);
		}
	};

	return (
		<>
			<div className="dash-page-header">
				<h1 className="dash-page-title">Replay</h1>
				<p className="dash-page-desc">
					Re-deliver historical blocks. Payloads include{" "}
					<code style={{ fontSize: 12 }}>isBackfill: true</code>
				</p>
			</div>

			<div className="dash-section-wrap">
				<hr />
				<h2 className="dash-section-title">New replay</h2>
			</div>

			<div
				style={{
					display: "flex",
					gap: 12,
					alignItems: "flex-end",
					marginTop: 4,
				}}
			>
				<div style={{ flex: 1 }}>
					<label
						style={{
							display: "block",
							fontSize: 12,
							fontWeight: 500,
							color: "var(--text-muted)",
							marginBottom: 6,
						}}
					>
						Start block
					</label>
					<input
						className="dash-input"
						type="text"
						inputMode="numeric"
						placeholder="150,000"
						value={fromBlock}
						onChange={(e) =>
							setFromBlock(e.target.value.replace(/[^0-9]/g, ""))
						}
					/>
				</div>
				<div style={{ flex: 1 }}>
					<label
						style={{
							display: "block",
							fontSize: 12,
							fontWeight: 500,
							color: "var(--text-muted)",
							marginBottom: 6,
						}}
					>
						End block
					</label>
					<input
						className="dash-input"
						type="text"
						inputMode="numeric"
						placeholder="151,000"
						value={toBlock}
						onChange={(e) => setToBlock(e.target.value.replace(/[^0-9]/g, ""))}
					/>
				</div>
				<button
					className="dash-btn primary"
					onClick={handleReplay}
					disabled={loading || !fromBlock || !toBlock}
					style={{ whiteSpace: "nowrap" }}
				>
					{loading
						? "Replaying..."
						: blockCount > 0
							? `Replay ${blockCount.toLocaleString()} blocks`
							: "Replay"}
				</button>
			</div>

			<p className="dash-hint">
				Max 10,000 blocks per request. Or{" "}
				<a style={{ color: "var(--accent-purple)", cursor: "pointer" }}>
					replay all failed deliveries
				</a>
			</p>

			{message && (
				<div className={`dash-inline-msg ${message.type}`}>{message.text}</div>
			)}

			<div className="dash-section-wrap">
				<hr />
				<h2 className="dash-section-title">Replay history</h2>
			</div>
			<div className="dash-empty">No replays yet</div>
		</>
	);
}
