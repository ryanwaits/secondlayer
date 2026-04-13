"use client";

import { useState } from "react";

interface DeployWorkflowCardProps {
	name: string;
	triggerSummary: string;
	reason?: string;
	onConfirm: (action: "deploy" | "cancel") => Promise<void> | void;
}

type Phase = "idle" | "bundling" | "deploying" | "error";

export function DeployWorkflowCard({
	name,
	triggerSummary,
	reason,
	onConfirm,
}: DeployWorkflowCardProps) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [errorText, setErrorText] = useState<string | null>(null);

	const handleDeploy = async () => {
		setPhase("bundling");
		setErrorText(null);
		try {
			await onConfirm("deploy");
		} catch (err) {
			setPhase("error");
			setErrorText(err instanceof Error ? err.message : String(err));
		}
	};

	if (phase === "error" && errorText) {
		return (
			<div className="tool-card">
				<div className="tool-card-header">Deploy failed</div>
				<pre className="tool-error-body">{errorText}</pre>
				<div className="tool-card-footer">
					<button
						type="button"
						className="tool-btn ghost"
						onClick={() => {
							setPhase("idle");
							setErrorText(null);
							onConfirm("cancel");
						}}
					>
						Dismiss
					</button>
					<button
						type="button"
						className="tool-btn primary"
						onClick={handleDeploy}
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	const busy = phase === "bundling" || phase === "deploying";

	return (
		<div className="tool-card">
			<div className="tool-card-header">Deploy workflow</div>
			<div className="tool-action-row">
				<div className="tool-action-detail">
					<span className="tool-status-name">{name}</span>
					<span className="tool-action-reason">{triggerSummary}</span>
					{reason && <span className="tool-action-reason">{reason}</span>}
				</div>
				<span className="tool-badge">HIL</span>
			</div>
			<div className="tool-card-footer">
				<button
					type="button"
					className="tool-btn ghost"
					disabled={busy}
					onClick={() => onConfirm("cancel")}
				>
					Cancel
				</button>
				<button
					type="button"
					className="tool-btn primary"
					disabled={busy}
					onClick={handleDeploy}
				>
					{busy ? "Deploying…" : "Deploy"}
				</button>
			</div>
		</div>
	);
}
