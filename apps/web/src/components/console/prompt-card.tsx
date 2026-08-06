"use client";

import { useCallback, useState } from "react";

/**
 * An agent prompt you can read before you copy it.
 *
 * The bare copy button it replaces asked for a blind hand-off: the prompt
 * carries live subscription state, so seeing the exact text matters both for
 * trust and for spotting stale context.
 */
export function PromptCard({
	name,
	description,
	prompt,
}: {
	name: string;
	description: string;
	prompt: string;
}) {
	const [copied, setCopied] = useState(false);

	const copy = useCallback(async () => {
		await navigator.clipboard.writeText(prompt);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [prompt]);

	return (
		<div className="sg-prompt">
			<div className="sg-prompt-head">
				<div>
					<div className="sg-prompt-name">{name}</div>
					<div className="sg-prompt-desc">{description}</div>
				</div>
				<div className="sg-prompt-act">
					<button type="button" className="dash-btn" onClick={copy}>
						{copied ? "Copied" : "Copy prompt"}
					</button>
				</div>
			</div>
			<details>
				<summary>Preview · {prompt.length.toLocaleString()} characters</summary>
				<pre>{prompt}</pre>
			</details>
		</div>
	);
}
