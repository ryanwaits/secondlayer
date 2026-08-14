"use client";

import { useEffect, useId, useRef, useState } from "react";

type Row = {
	title: string;
	cmd: string;
};

const ROWS: Row[] = [
	{
		title: "Install script",
		cmd: "curl -fsSL https://secondlayer.tools/install.sh | bash",
	},
	{ title: "Bun", cmd: "bun add -g @secondlayer/cli" },
	{ title: "npm", cmd: "npm install -g @secondlayer/cli" },
	{ title: "pnpm", cmd: "pnpm add -g @secondlayer/cli" },
	{
		title: "Claude Code skill",
		cmd: "curl -fsSL https://secondlayer.tools/skill.sh | bash",
	},
];

/**
 * Primary nav action: an Install pill that drops an in-place menu of install
 * commands — the curl script first, then package managers, then the Claude
 * Code skill. Every row copies its command.
 */
export function InstallMenu() {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		const onClick = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("click", onClick);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("click", onClick);
		};
	}, [open]);

	async function copy(row: Row) {
		try {
			await navigator.clipboard.writeText(row.cmd);
		} catch {}
		setCopied(row.title);
		setTimeout(() => setCopied(null), 1200);
	}

	return (
		<div className="imenu" ref={rootRef}>
			<button
				type="button"
				className="imenu-btn"
				aria-expanded={open}
				aria-controls={menuId}
				onClick={() => setOpen((v) => !v)}
			>
				Install
				<svg
					className="imenu-chev"
					width="10"
					height="6"
					viewBox="0 0 10 6"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeLinecap="round"
					aria-hidden="true"
					data-open={open ? "" : undefined}
				>
					<path d="M1 1l4 4 4-4" />
				</svg>
			</button>
			{open ? (
				<div className="imenu-panel" id={menuId}>
					<p className="imenu-head">Run secondlayer today · free</p>
					{ROWS.map((row) => (
						<button
							key={row.title}
							type="button"
							className="imenu-row"
							onClick={() => void copy(row)}
						>
							<span className="imenu-row-text">
								<span className="imenu-row-title">{row.title}</span>
								<code className="imenu-row-cmd">{row.cmd}</code>
							</span>
							<span className="imenu-copy" aria-hidden="true">
								{copied === row.title ? (
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
							<span className="acr-visually-hidden" aria-live="polite">
								{copied === row.title ? "Copied" : ""}
							</span>
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
