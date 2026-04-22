import { OverviewTopbar } from "@/components/console/overview-topbar";
import { apiRequest, getSessionFromCookies } from "@/lib/api";
import Link from "next/link";
import { notFound } from "next/navigation";

interface StepRow {
	id: string;
	stepId: string;
	status: string;
	attempts: number;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	durationMs: number | null;
	output: unknown;
	error: string | null;
}

interface RunDetail {
	run: {
		id: string;
		workflowName: string;
		status: string;
		input: unknown;
		output: unknown;
		error: string | null;
		startedAt: string | null;
		completedAt: string | null;
		createdAt: string;
		steps: StepRow[];
	};
}

function formatDate(ts: string | null): string {
	if (!ts) return "—";
	return new Date(ts).toLocaleString();
}

function formatDuration(ms: number | null): string {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}

function statusBadgeClass(status: string): string {
	if (status === "completed" || status === "success") return "active";
	if (status === "failed" || status === "error") return "danger";
	return "";
}

export default async function RunDetailPage({
	params,
}: {
	params: Promise<{ id: string; runId: string }>;
}) {
	const { id, runId } = await params;
	const session = await getSessionFromCookies();
	if (!session) notFound();

	const data = await apiRequest<RunDetail>(
		`/api/sentries/${id}/runs/${runId}`,
		{ sessionToken: session, tags: ["sentries", id, "runs", runId] },
	).catch(() => null);

	if (!data) notFound();
	const { run } = data;
	const totalMs =
		run.startedAt && run.completedAt
			? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
			: null;

	return (
		<>
			<OverviewTopbar
				path="Sentries"
				page={`Run ${run.id.slice(0, 8)}`}
				showRefresh={false}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner" style={{ maxWidth: 900 }}>
					<div style={{ marginBottom: 12 }}>
						<Link
							href={`/sentries/${id}`}
							style={{ fontSize: 13, color: "var(--fg-muted)" }}
						>
							← Back to sentry
						</Link>
					</div>

					<div style={{ marginBottom: 20 }}>
						<h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
							<span
								className={`badge ${statusBadgeClass(run.status)}`}
								style={{ marginRight: 10, fontSize: 12 }}
							>
								{run.status}
							</span>
							<code>{run.id.slice(0, 8)}</code>
						</h1>
						<div
							style={{
								fontSize: 13,
								color: "var(--fg-muted)",
								marginTop: 4,
							}}
						>
							<code>{run.workflowName}</code> · started{" "}
							{formatDate(run.startedAt)} · {formatDuration(totalMs)} ·{" "}
							{run.steps.length} step{run.steps.length === 1 ? "" : "s"}
						</div>
					</div>

					{run.error && (
						<div
							className="callout error"
							role="alert"
							style={{ marginBottom: 20 }}
						>
							<div className="callout-body">
								<div className="callout-title">Run failed</div>
								<div className="callout-sub">
									<code>{run.error}</code>
								</div>
							</div>
						</div>
					)}

					<section
						style={{
							border: "1px solid var(--border)",
							borderRadius: 6,
							padding: 16,
							marginBottom: 24,
						}}
					>
						<h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
							Input
						</h2>
						<pre
							style={{
								fontSize: 12,
								margin: 0,
								padding: 12,
								background: "var(--surface, #fafafa)",
								borderRadius: 4,
								overflow: "auto",
							}}
						>
							{JSON.stringify(run.input, null, 2)}
						</pre>
					</section>

					<section>
						<h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
							Steps
						</h2>
						{run.steps.length === 0 ? (
							<div
								style={{
									padding: 20,
									border: "1px dashed var(--border)",
									borderRadius: 6,
									textAlign: "center",
									fontSize: 13,
									color: "var(--fg-muted)",
								}}
							>
								No steps recorded yet.
							</div>
						) : (
							<div
								style={{
									border: "1px solid var(--border)",
									borderRadius: 6,
									overflow: "hidden",
								}}
							>
								{run.steps.map((s) => (
									<details
										key={s.id}
										style={{
											padding: 12,
											borderBottom: "1px solid var(--border)",
										}}
									>
										<summary
											style={{
												display: "flex",
												gap: 12,
												alignItems: "center",
												cursor: "pointer",
												listStyle: "none",
											}}
										>
											<span
												className={`badge ${statusBadgeClass(s.status)}`}
												style={{ fontSize: 11 }}
											>
												{s.status}
											</span>
											<code style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
												{s.stepId}
											</code>
											<span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
												{formatDuration(s.durationMs)}
												{s.attempts > 1 ? ` · ${s.attempts} attempts` : ""}
											</span>
										</summary>
										{s.error && (
											<pre
												style={{
													fontSize: 11,
													marginTop: 8,
													padding: 8,
													color: "var(--error-fg, #933)",
													background: "var(--error-bg, #fee)",
													borderRadius: 4,
													overflow: "auto",
												}}
											>
												{s.error}
											</pre>
										)}
										{s.output != null && (
											<pre
												style={{
													fontSize: 11,
													marginTop: 8,
													padding: 8,
													background: "var(--surface, #fafafa)",
													borderRadius: 4,
													overflow: "auto",
													maxHeight: 300,
												}}
											>
												{JSON.stringify(s.output, null, 2)}
											</pre>
										)}
									</details>
								))}
							</div>
						)}
					</section>
				</div>
			</div>
		</>
	);
}
