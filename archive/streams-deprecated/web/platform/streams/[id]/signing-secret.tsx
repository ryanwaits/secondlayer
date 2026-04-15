"use client";

import { useCallback, useState } from "react";

export function SigningSecret({ secret }: { secret: string | undefined }) {
	const [revealed, setRevealed] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleCopy = useCallback(async () => {
		if (!secret) return;
		await navigator.clipboard.writeText(secret);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [secret]);

	return (
		<span className="sg-secret">
			<span className="sg-secret-value">
				{revealed && secret ? secret : "•".repeat(16)}
			</span>
			<button
				type="button"
				className="sg-secret-btn"
				onClick={() => setRevealed(!revealed)}
			>
				{revealed ? "Hide" : "Reveal"}
			</button>
			<button
				type="button"
				className="sg-secret-btn"
				onClick={handleCopy}
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</span>
	);
}
