"use client";

import { useCallback, useState } from "react";

export function CopyButton({
	code,
	label,
	inline,
	umamiEvent = "copy-code",
}: {
	code: string;
	/** Optional text label rendered before the icon (toggles to "copied"). */
	label?: string;
	/** Render statically in-flow (header/toolbar) instead of the default
	 *  absolute, hover-revealed icon used inside code blocks. Implied by `label`. */
	inline?: boolean;
	/** Umami event fired on copy. Defaults to "copy-code"; override per usage
	 *  (e.g. "fork-explore" on the Explore scaffold command). */
	umamiEvent?: string;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [code]);

	return (
		<button
			type="button"
			onClick={handleCopy}
			className={
				label || inline ? "copy-button copy-button-labeled" : "copy-button"
			}
			aria-label="Copy code"
		>
			{label && (
				<span className="copy-button-label">{copied ? "copied" : label}</span>
			)}
			{copied ? (
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<polyline points="20 6 9 17 4 12" />
				</svg>
			) : (
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
					<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
				</svg>
			)}
		</button>
	);
}
