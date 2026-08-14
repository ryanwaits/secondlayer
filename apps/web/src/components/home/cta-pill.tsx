"use client";

import { useState } from "react";

const INSTALL_CMD = "bun add -g @secondlayer/cli";

/** Hero CTA — copyable CLI install command. */
export function CtaPill() {
	const [copied, setCopied] = useState(false);

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {}
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	}

	return (
		<button
			type="button"
			className="home-cmd"
			onClick={() => copy(INSTALL_CMD)}
			aria-label="Copy install command"
		>
			<span className="p">$</span>
			<span className="home-cmd-label">{INSTALL_CMD}</span>
			<span className="cp">{copied ? "copied" : "copy"}</span>
		</button>
	);
}
