"use client";

import { useCopied } from "@/lib/use-copied";
import { useCallback } from "react";

export function CopyButton({
	code,
	label,
	inline,
}: {
	code: string;
	label?: string;
	inline?: boolean;
}) {
	const { copied, copy } = useCopied(1500);

	const handleCopy = useCallback(async () => {
		await copy(code);
	}, [code, copy]);

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
			{copied ? <CheckIcon /> : <CopyIcon />}
		</button>
	);
}

const iconProps = {
	width: 14,
	height: 14,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

export function CopyIcon() {
	return (
		<svg aria-hidden="true" {...iconProps}>
			<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</svg>
	);
}

export function CheckIcon() {
	return (
		<svg aria-hidden="true" {...iconProps}>
			<polyline points="20 6 9 17 4 12" />
		</svg>
	);
}
