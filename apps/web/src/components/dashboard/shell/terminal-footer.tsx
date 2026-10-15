"use client";

import { truncateMiddle } from "@/lib/terminal-command";
import { useEffect, useRef, useState } from "react";

/** Sticky footer naming the CLI command for the current view. */
export function TerminalFooter({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	function copy() {
		navigator.clipboard
			?.writeText(command)
			.then(() => {
				setCopied(true);
				clearTimeout(timer.current);
				timer.current = setTimeout(() => setCopied(false), 1200);
			})
			.catch(() => {});
	}

	return (
		<footer className="dash-foot">
			<span>
				This view in your terminal: <code>{truncateMiddle(command)}</code>
			</span>
			<button
				type="button"
				className="dash-foot-copy"
				data-command={command}
				onClick={copy}
			>
				{copied ? "Copied" : "Copy"}
			</button>
		</footer>
	);
}
