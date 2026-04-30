"use client";

import { useProjects } from "@/lib/queries/projects";
import { type ReactNode, useEffect, useRef, useState } from "react";

export function ProjectSwitcher({ avatar }: { avatar?: ReactNode }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const { data: projects } = useProjects();

	// For now, first project is "active" — will be route-based later
	const current = projects?.[0];

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
					{(projects ?? []).map((p) => (
						<button
							type="button"
							key={p.id}
							className={`org-popover-item${p.id === current?.id ? " active" : ""}`}
							onClick={() => setOpen(false)}
						>
							{p.name}
							<span className="org-popover-check">
								<svg
									aria-hidden="true"
									width="12"
									height="12"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M3 8.5l3.5 3.5 6.5-8" />
								</svg>
							</span>
						</button>
					))}
					{projects?.length === 0 && (
						<div className="org-popover-item">No projects yet</div>
					)}
					<div className="org-popover-divider" />
					<button
						type="button"
						className="org-popover-create"
						onClick={() => setOpen(false)}
					>
						<svg
							aria-hidden="true"
							width="12"
							height="12"
							viewBox="0 0 12 12"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						>
							<path d="M6 2v8M2 6h8" />
						</svg>
						Create new project
					</button>
				</div>
			)}
			<button
				type="button"
				className="org-trigger"
				onClick={() => setOpen(!open)}
			>
				<span className="org-name">{current?.name ?? "No project"}</span>
				<span className="org-chevron">
					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					>
						<path d="M4 6l4 4 4-4" />
					</svg>
				</span>
			</button>
			{avatar}
		</div>
	);
}
