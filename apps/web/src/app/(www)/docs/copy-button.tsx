"use client";

import { useState } from "react";

/** Copy-to-clipboard icon button used by the Quickstart panel + guided
 *  session. Swaps to a check for ~1.4s on success. */
export function CopyButton({
	text,
	className,
	label = "Copy command",
}: { text: string; className?: string; label?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className={className}
			aria-label={label}
			data-umami-event="copy-code"
			onClick={() => {
				navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 1400);
			}}
		>
			{copied ? (
				<svg
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
				</svg>
			) : (
				<svg
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<rect x="5" y="5" width="9" height="9" rx="1.5" />
					<path d="M5 11H3.5A1.5 1.5 0 0 1 2 9.5V3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V5" />
				</svg>
			)}
		</button>
	);
}
