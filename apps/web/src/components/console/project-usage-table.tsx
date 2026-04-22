import { formatBytes, formatHours, formatNum } from "@/lib/usage";
import type { UsageProject } from "@/lib/usage";
import Link from "next/link";

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
				No projects yet.{" "}
				<Link
					href="/instance"
					style={{ color: "var(--text-main)", fontWeight: 500 }}
				>
					Create one →
				</Link>
			</div>
		);
	}

	return (
		<div className="project-table">
			<div className="project-table-head">
				<div>Name</div>
				<div>Compute</div>
				<div>Storage</div>
				<div>AI /day</div>
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
					<div className="num">
						{formatHours(p.compute.hours)} h
						<span className="sub">{Math.round(p.compute.pct)}%</span>
					</div>
					<div className="num">
						{formatBytes(p.storage.bytes)}
						<span className="sub">{Math.round(p.storage.pct)}%</span>
					</div>
					<div className="num">
						{formatNum(p.aiEvals.todayCount)}
						<span className="sub">{Math.round(p.aiEvals.pct)}%</span>
					</div>
				</div>
			))}
		</div>
	);
}
