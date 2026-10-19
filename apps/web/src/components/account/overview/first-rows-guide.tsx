"use client";

import { FIRST_ROWS_PROMPT } from "@/lib/onboarding";
import Link from "next/link";
import { type ReactNode, useState } from "react";

/**
 * Checklist step 2 for an account with a key and no reads: one prompt for a
 * coding assistant, or one read three ways. The blocks are server-rendered
 * (`first-rows-code.tsx`) and passed in.
 */
export function FirstRowsGuide({
	code,
	prompt,
	onSkip,
}: {
	code: ReactNode;
	prompt: ReactNode;
	onSkip: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);

	function copy() {
		navigator.clipboard.writeText(FIRST_ROWS_PROMPT).catch(() => {});
		setCopied(true);
		setTimeout(() => setCopied(false), 1400);
	}

	return (
		<div className="fr">
			<div className="fr-prompt">
				<p>
					Using a coding assistant? <span>Paste one prompt.</span>
				</p>
				<div className="fr-acts">
					<button
						type="button"
						className="acct-btn line small"
						aria-expanded={open}
						onClick={() => setOpen((v) => !v)}
					>
						{open ? "Hide" : "Show"}
					</button>
					<button type="button" className="acct-btn solid small" onClick={copy}>
						{copied ? "Copied" : "Copy prompt"}
					</button>
				</div>
			</div>
			{open ? prompt : null}
			<p className="fr-label">
				Or run it yourself.{" "}
				<span>The last 5 sBTC transfers, with the key you just copied.</span>
			</p>
			{code}
			<div className="fr-foot">
				<span>Rows are free up to 1M a month.</span>
				<span className="fr-links">
					<Link href="/docs/index">Every Index endpoint ›</Link>
					<button type="button" className="fr-skip" onClick={onSkip}>
						Skip
					</button>
				</span>
			</div>
		</div>
	);
}
