"use client";

import { truncateMiddle } from "@/lib/terminal-command";
import { useCopied } from "@/lib/use-copied";

/** Commands longer than this truncate in the middle; a click copies the whole one. */
const CHIP_MAX = 34;

const iconProps = {
	width: 13,
	height: 13,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

const CopyIcon = () => (
	<svg aria-hidden="true" {...iconProps}>
		<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
	</svg>
);

const CheckIcon = () => (
	<svg aria-hidden="true" {...iconProps}>
		<polyline points="20 6 9 17 4 12" />
	</svg>
);

/** The CLI command for the current view, as a copy bar in the dashboard
 *  nav. Click copies it: the dashboard always points back to the terminal. */
export function ViewCommand({ command }: { command: string }) {
	const { copied, copy: copyCommand } = useCopied(1200);

	function copy() {
		copyCommand(command);
	}

	return (
		<button
			type="button"
			className="dash-cmd"
			data-command={command}
			title={`This view in your terminal: ${command}. Click to copy.`}
			aria-label={
				copied
					? "Copied"
					: `Copy the terminal command for this view: ${command}`
			}
			aria-live="polite"
			onClick={copy}
		>
			<code>{truncateMiddle(command, CHIP_MAX, 22, 10)}</code>
			<span className="dash-cmd-copy">
				{copied ? <CheckIcon /> : <CopyIcon />}
			</span>
		</button>
	);
}
