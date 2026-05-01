"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

interface PromptActionsProps {
	prompt: string;
	openLabel?: string;
	copyLabel?: string;
}

export function PromptActions({
	prompt,
	openLabel = "Open in chat",
	copyLabel = "Copy agent prompt",
}: PromptActionsProps) {
	const router = useRouter();
	const [copied, setCopied] = useState(false);

	const open = useCallback(() => {
		const id = crypto.randomUUID();
		router.push(`/sessions/${id}?q=${encodeURIComponent(prompt)}`);
	}, [prompt, router]);

	const copy = useCallback(async () => {
		await navigator.clipboard.writeText(prompt);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [prompt]);

	return (
		<div className="prompt-actions">
			<button type="button" className="btn-secondary" onClick={open}>
				{openLabel}
			</button>
			<button type="button" className="btn-secondary" onClick={copy}>
				{copied ? "Copied" : copyLabel}
			</button>
		</div>
	);
}
