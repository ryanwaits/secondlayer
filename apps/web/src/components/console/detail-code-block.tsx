"use client";

import { type ReactNode, useCallback, useState } from "react";

interface DetailCodeBlockProps {
	label: string;
	code: string;
	showCopy?: boolean;
	showOpenInEditor?: boolean;
	actions?: ReactNode;
	children?: ReactNode;
}

export function DetailCodeBlock({
	label,
	code,
	showCopy = true,
	showOpenInEditor = false,
	actions,
	children,
}: DetailCodeBlockProps) {
	const [copied, setCopied] = useState(false);
	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [code]);

	return (
		<div className="sg-code-block">
			<div className="sg-code-header">
				<span>
					{label}{" "}
					<span className="info">
						<svg
							aria-hidden="true"
							width="10"
							height="10"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						>
							<circle cx="8" cy="8" r="6" />
							<path d="M8 7v4" />
							<circle cx="8" cy="5" r="0.5" fill="currentColor" />
						</svg>
					</span>
				</span>
				<div className="sg-code-actions">
					{showCopy && (
						<button type="button" className="sg-code-btn" onClick={handleCopy}>
							<svg
								aria-hidden="true"
								width="10"
								height="10"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							>
								<rect x="5" y="5" width="9" height="9" rx="1.5" />
								<path d="M5 11H3.5A1.5 1.5 0 0 1 2 9.5V3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V5" />
							</svg>
							{copied ? "Copied" : "Copy"}
						</button>
					)}
					{showOpenInEditor && (
						<button type="button" className="sg-code-btn">
							<svg
								aria-hidden="true"
								width="10"
								height="10"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							>
								<path d="M6 3H3v10h10v-3" />
								<path d="M7 9l7-7" />
								<path d="M10 2h4v4" />
							</svg>
							Open in editor
						</button>
					)}
					{actions}
				</div>
			</div>
			<div className="sg-code-body">{children || <code>{code}</code>}</div>
		</div>
	);
}
