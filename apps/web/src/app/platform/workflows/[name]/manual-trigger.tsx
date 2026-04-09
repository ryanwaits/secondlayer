"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ManualTrigger({ workflowName }: { workflowName: string }) {
	const router = useRouter();
	const [input, setInput] = useState("");
	const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
		"idle",
	);
	const [runId, setRunId] = useState<string | null>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	async function handleTrigger() {
		setStatus("sending");
		setErrorMsg(null);
		try {
			let body: unknown;
			if (input.trim()) {
				body = { input: JSON.parse(input) };
			}
			const res = await fetch(`/api/workflows/${workflowName}/trigger`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: body ? JSON.stringify(body) : undefined,
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.error || `HTTP ${res.status}`);
			}
			const data = await res.json();
			setRunId(data.runId);
			setStatus("done");
			router.refresh();
		} catch (e) {
			setErrorMsg(e instanceof Error ? e.message : "Failed to trigger");
			setStatus("error");
		}
	}

	return (
		<div>
			<p
				style={{
					fontSize: 12,
					color: "var(--text-muted)",
					marginBottom: 10,
					lineHeight: 1.5,
				}}
			>
				Send a manual trigger with optional JSON input payload.
			</p>
			<div
				style={{
					border: "1px solid var(--border)",
					borderRadius: 8,
					overflow: "hidden",
				}}
			>
				<div style={{ padding: 12 }}>
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder='{ "address": "SP2J6...", "note": "test run" }'
						style={{
							width: "100%",
							minHeight: 80,
							fontFamily: "var(--font-mono-stack)",
							fontSize: 12,
							color: "var(--text-main)",
							background: "var(--code-block-bg)",
							border: "1px solid var(--border)",
							borderRadius: 6,
							padding: "10px 12px",
							resize: "vertical",
							outline: "none",
							lineHeight: 1.6,
						}}
					/>
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "flex-end",
						gap: 8,
						padding: "0 12px 12px",
					}}
				>
					{status === "done" && runId && (
						<span
							style={{
								fontSize: 12,
								color: "var(--green)",
								fontFamily: "var(--font-mono-stack)",
							}}
						>
							Triggered: {runId.slice(0, 8)}
						</span>
					)}
					{status === "error" && errorMsg && (
						<span style={{ fontSize: 12, color: "var(--red)" }}>
							{errorMsg}
						</span>
					)}
					<button
						type="button"
						className="create-submit"
						disabled={status === "sending"}
						onClick={handleTrigger}
					>
						{status === "sending" ? "Triggering…" : "Trigger Run"}
					</button>
				</div>
			</div>
		</div>
	);
}
