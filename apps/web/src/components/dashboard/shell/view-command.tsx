"use client";

import { truncateMiddle } from "@/lib/terminal-command";
import { useEffect, useRef, useState } from "react";

/** Commands longer than this truncate in the middle; a click copies the whole one. */
const CHIP_MAX = 34;

/** The CLI command for the current view, as a copy bar in the dashboard
 *  nav. Click copies it: the dashboard always points back to the terminal. */
export function ViewCommand({ command }: { command: string }) {
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
		<button
			type="button"
			className="dash-cmd"
			data-command={command}
			title={`This view in your terminal: ${command}. Click to copy.`}
			aria-label={`Copy the terminal command for this view: ${command}`}
			onClick={copy}
		>
			<code>{truncateMiddle(command, CHIP_MAX, 22, 10)}</code>
			<span className="dash-cmd-copy" aria-live="polite">
				{copied ? "Copied" : "Copy"}
			</span>
		</button>
	);
}
