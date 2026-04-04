"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const PROJECTS = [
	{ name: "my-project", active: true },
	{ name: "stx-analytics", active: false },
	{ name: "defi-dashboard", active: false },
];

export function ProjectSwitcher({ avatar }: { avatar?: ReactNode }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const current = PROJECTS.find((p) => p.active) || PROJECTS[0];

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("click", handleClick);
		return () => document.removeEventListener("click", handleClick);
	}, []);

	return (
		<div className="sidebar-org" ref={ref}>
			{open && (
				<div className="org-popover">
					<div className="org-popover-title">Projects</div>
					{PROJECTS.map((p) => (
						<div
							key={p.name}
							className={`org-popover-item${p.active ? " active" : ""}`}
							onClick={() => setOpen(false)}
						>
							{p.name}
							<span className="org-popover-check">
								<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
									<path d="M3 8.5l3.5 3.5 6.5-8" />
								</svg>
							</span>
						</div>
					))}
					<div className="org-popover-divider" />
					<div className="org-popover-create" onClick={() => setOpen(false)}>
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
							<path d="M6 2v8M2 6h8" />
						</svg>
						Create new project
					</div>
				</div>
			)}
			<div className="org-trigger" onClick={() => setOpen(!open)}>
				<span className="org-name">{current.name}</span>
				<span className="org-chevron">
					<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
						<path d="M4 6l4 4 4-4" />
					</svg>
				</span>
			</div>
			{avatar}
		</div>
	);
}
