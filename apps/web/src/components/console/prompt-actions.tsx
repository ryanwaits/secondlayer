"use client";

import { useCallback, useState } from "react";

interface PromptActionsProps {
	prompt: string;
	copyLabel?: string;
}

export function PromptActions({
	prompt,
	copyLabel = "Copy agent prompt",
}: PromptActionsProps) {
	const [copied, setCopied] = useState(false);

	const copy = useCallback(async () => {
		await navigator.clipboard.writeText(prompt);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [prompt]);

	return (
		<div className="prompt-actions">
			<button type="button" className="btn-secondary" onClick={copy}>
				{copied ? "Copied" : copyLabel}
			</button>
		</div>
	);
}
