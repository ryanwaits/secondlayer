"use client";

import { useState } from "react";

interface ToolCallIndicatorProps {
	toolName: string;
	state: string;
	input?: unknown;
	output?: unknown;
}

export function ToolCallIndicator({
	toolName,
	state,
	input,
	output,
}: ToolCallIndicatorProps) {
	const [expanded, setExpanded] = useState(false);
	const isLoading = state === "input-streaming" || state === "input-available";

	return (
		<>
			<div
				className={`tool-call-indicator ${expanded ? "expanded" : ""}`}
				onClick={() => !isLoading && setExpanded(!expanded)}
			>
				<svg
					className="tool-call-icon"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<path d="M9.5 2.5l4 4-4 4" />
					<path d="M6.5 2.5l-4 4 4 4" />
				</svg>
				<span className="tool-call-name">{toolName}</span>
				{isLoading ? (
					<div className="tool-call-dots">
						<span />
						<span />
						<span />
					</div>
				) : (
					<svg
						className="tool-call-chevron"
						viewBox="0 0 8 8"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					>
						<path d="M2 1.5l3 2.5-3 2.5" />
					</svg>
				)}
			</div>
			{expanded && !isLoading && (
				<div className="tool-call-detail">
					{input !== undefined && <div>input: {formatCompact(input)}</div>}
					{output !== undefined && <div>output: {formatCompact(output)}</div>}
				</div>
			)}
		</>
	);
}

function formatCompact(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value !== "object") return String(value);
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj);
	if (keys.length === 0) return "{}";
	const parts = keys.map((k) => {
		const v = obj[k];
		if (Array.isArray(v)) return `${k}: [${v.length} items]`;
		if (typeof v === "string" && v.length > 40)
			return `${k}: "${v.slice(0, 40)}..."`;
		if (typeof v === "object" && v !== null) return `${k}: {...}`;
		return `${k}: ${JSON.stringify(v)}`;
	});
	return `{ ${parts.join(", ")} }`;
}
