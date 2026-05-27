import { formatBytes, formatHours } from "@/lib/usage";
import type { UsageProject } from "@/lib/usage";

interface Props {
	projects: UsageProject[];
}

export function ProjectUsageTable({ projects }: Props) {
	if (projects.length === 0) {
		return (
			<div
				style={{
					padding: 24,
					border: "1px dashed var(--border)",
					borderRadius: 8,
					textAlign: "center",
					fontSize: 13,
					color: "var(--text-muted)",
				}}
			>
				No projects yet.
			</div>
		);
	}

	return (
		<div className="project-table">
			<div className="project-table-head">
				<div>Name</div>
				<div>Compute</div>
				<div>Storage</div>
			</div>
			{projects.map((p) => (
				<div
					key={p.id}
					className={`project-row ${p.status === "paused" ? "paused" : ""}`}
				>
					<div className="tenant-name">
						<span className={`status-dot ${p.status}`} />
						{p.name}
					</div>
					<div className="num">{formatHours(p.compute.hours)} h</div>
					<div className="num">{formatBytes(p.storage.bytes)}</div>
				</div>
			))}
		</div>
	);
}
