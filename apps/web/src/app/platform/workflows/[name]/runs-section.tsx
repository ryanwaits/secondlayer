"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface RunSummary {
	id: string;
	status: string;
	triggerType: string;
	durationMs: number | null;
	totalAiTokens: number | null;
	startedAt: string | null;
	createdAt: string;
}

function statusBadgeClass(status: string) {
	if (status === "completed") return "active";
	if (status === "running") return "syncing";
	if (status === "failed") return "error";
	return "";
}

function formatDate(dateStr: string | null) {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatDuration(ms: number | null) {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function WorkflowRunsSection({
	workflowName,
}: {
	workflowName: string;
}) {
	const [runs, setRuns] = useState<RunSummary[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetch(`/api/workflows/${workflowName}/runs?limit=10`)
			.then((r) => r.json())
			.then((data) => setRuns(data.runs ?? []))
			.catch(() => {})
			.finally(() => setLoading(false));
	}, [workflowName]);

	if (loading) {
		return (
			<div
				style={{ padding: "12px 0", fontSize: 12, color: "var(--text-muted)" }}
			>
				Loading runs…
			</div>
		);
	}

	if (runs.length === 0) {
		return (
			<div
				style={{ padding: "12px 0", fontSize: 12, color: "var(--text-muted)" }}
			>
				No runs yet.
			</div>
		);
	}

	return (
		<div className="dash-data-table-wrap">
			<table className="dash-data-table">
				<thead>
					<tr>
						<th>Run ID</th>
						<th>Status</th>
						<th>Duration</th>
						<th>AI Tokens</th>
						<th>Started</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run) => (
						<tr key={run.id}>
							<td>
								<Link
									href={`/platform/workflows/${workflowName}/runs/${run.id}`}
									className="dash-data-link"
								>
									{run.id.slice(0, 8)}
								</Link>
							</td>
							<td>
								<span className={`badge ${statusBadgeClass(run.status)}`}>
									{run.status}
								</span>
							</td>
							<td className="muted">{formatDuration(run.durationMs)}</td>
							<td className="muted">{run.totalAiTokens ?? "—"}</td>
							<td className="muted">
								{formatDate(run.startedAt ?? run.createdAt)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
