"use client";

import { useState } from "react";

export function QuickStartCard({
	icon,
	label,
	description,
	copyText,
}: {
	icon: React.ReactNode;
	label: string;
	description: string;
	copyText: string;
}) {
	const [copied, setCopied] = useState(false);

	function handleCopy() {
		navigator.clipboard.writeText(copyText).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	}

	return (
		<div className="quick-action" onClick={handleCopy}>
			<div className="quick-action-icon">{icon}</div>
			<div className="quick-action-text">
				<span className="quick-action-label">{label}</span>
				<span className="quick-action-desc">{description}</span>
			</div>
			<button
				className={`create-submit${copied ? " copied" : ""}`}
				style={{ fontSize: 10, padding: "3px 10px" }}
				onClick={(e) => {
					e.stopPropagation();
					handleCopy();
				}}
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</div>
	);
}

export function QuickStartSection({ children }: { children: React.ReactNode }) {
	return (
		<>
			<div className="dash-section-wrap" style={{ marginTop: 28 }}>
				<hr />
				<h2 className="dash-section-title">Quick start</h2>
			</div>
			<div className="quick-actions">{children}</div>
			<p className="dash-hint" style={{ textAlign: "center", marginTop: 8 }}>
				Paste into Claude Code, Cursor, Windsurf, or any agent
			</p>
		</>
	);
}
