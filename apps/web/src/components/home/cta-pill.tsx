"use client";

import { useState } from "react";

const INSTALL_CMD = "bun add -g @secondlayer/cli";

/** Hero CTA — copyable CLI install command. */
export function CtaPill() {
	const [copied, setCopied] = useState(false);

	async function copy(text: string) {
		setCopied(true);
		try {
			await navigator.clipboard.writeText(text);
		} catch {}
		setTimeout(() => setCopied(false), 1200);
	}

	return (
		<button
			type="button"
			className="home-cmd"
			onClick={() => copy(INSTALL_CMD)}
			aria-label={copied ? "Copied install command" : "Copy install command"}
		>
			<span className="p">$</span>
			<span className="home-cmd-label">{INSTALL_CMD}</span>
			<span className="home-cmd-rule" aria-hidden="true" />
			<span className="home-cmd-ic" aria-hidden="true">
				{copied ? (
					<svg
						width="14"
						height="14"
						viewBox="0 0 14 14"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M3 7.2l2.4 2.4L11 4"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				) : (
					<svg
						width="14"
						height="14"
						viewBox="0 0 14 14"
						fill="none"
						aria-hidden="true"
					>
						<rect
							x="5"
							y="5"
							width="7"
							height="7"
							rx="1.2"
							stroke="currentColor"
							strokeWidth="1.3"
						/>
						<path
							d="M3 9V3.8A1.2 1.2 0 0 1 4.2 2.6H9"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
						/>
					</svg>
				)}
			</span>
		</button>
	);
}
