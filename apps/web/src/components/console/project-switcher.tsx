"use client";

import { useProjects } from "@/lib/queries/projects";
import type { ReactNode } from "react";

/**
 * Single-project per account: this is a static label, not a switcher. The name
 * is editable on the Project settings page. Kept as a component (with the
 * trailing avatar slot) so the sidebar footer layout is unchanged.
 */
export function ProjectSwitcher({ avatar }: { avatar?: ReactNode }) {
	const { data: projects } = useProjects();
	const current = projects?.[0];

	return (
		<div className="sidebar-org">
			<span className="org-trigger org-static">
				<span className="org-name">{current?.name ?? "No project"}</span>
			</span>
			{avatar}
		</div>
	);
}
