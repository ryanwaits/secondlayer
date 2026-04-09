"use client";

import { DetailCodeBlock } from "@/components/console/detail-code-block";
import { DetailSection } from "@/components/console/detail-section";
import { MetaGrid } from "@/components/console/meta-grid";
import { OverviewTopbar } from "@/components/console/overview-topbar";
import type { WorkflowRunDetail, WorkflowStep } from "@/lib/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

function statusBadgeClass(status: string) {
	if (status === "completed") return "active";
	if (status === "running") return "syncing";
	if (status === "failed") return "error";
	return "";
}

function formatDuration(ms: number | null) {
	if (ms == null) return "—";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr: string | null) {
	if (!dateStr) return "—";
	return new Date(dateStr).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
	});
}

function StepTypeIcon({ type }: { type: string }) {
	const colors: Record<string, string> = {
		ai: "var(--accent)",
		query: "var(--blue)",
		deliver: "var(--green)",
		run: "var(--text-muted)",
		sleep: "var(--yellow)",
		invoke: "var(--teal, var(--blue))",
		mcp: "var(--accent)",
	};
	return (
		<span
			style={{
				fontFamily: "var(--font-mono-stack)",
				fontSize: 10,
				fontWeight: 600,
				color: colors[type] ?? "var(--text-muted)",
				background: "var(--code-bg)",
				padding: "2px 8px",
				borderRadius: 3,
				textTransform: "uppercase",
			}}
		>
			{type}
		</span>
	);
}

function StepCard({ step }: { step: WorkflowStep }) {
	const [open, setOpen] = useState(false);
	const isCompleted = step.status === "completed";
	const isFailed = step.status === "failed";

	return (
		<div style={{ display: "flex", gap: 16 }}>
			{/* Indicator */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					flexShrink: 0,
					width: 24,
				}}
			>
				<div
					style={{
						width: 24,
						height: 24,
						borderRadius: "50%",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						border: `1.5px solid ${isFailed ? "var(--red)" : isCompleted ? "var(--green)" : "var(--border)"}`,
						background: isFailed
							? "var(--red-bg)"
							: isCompleted
								? "var(--green-bg)"
								: "var(--bg)",
						color: isFailed
							? "var(--red)"
							: isCompleted
								? "var(--green)"
								: "var(--text-muted)",
						fontSize: 11,
						fontWeight: 600,
						zIndex: 1,
					}}
				>
					{isCompleted ? "✓" : isFailed ? "✕" : step.stepIndex + 1}
				</div>
				<div
					style={{
						width: 1,
						flex: 1,
						background: "var(--border)",
						minHeight: 12,
					}}
				/>
			</div>

			{/* Card */}
			<div
				style={{
					flex: 1,
					border: "1px solid var(--border)",
					borderRadius: 8,
					marginBottom: 12,
					overflow: "hidden",
				}}
			>
				<button
					type="button"
					onClick={() => setOpen(!open)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						padding: "10px 14px",
						width: "100%",
						background: "none",
						border: "none",
						color: "var(--text-main)",
						textAlign: "left",
						cursor: "pointer",
						fontFamily: "inherit",
						fontSize: 13,
					}}
				>
					<span
						style={{
							fontFamily: "var(--font-mono-stack)",
							fontSize: 12,
							fontWeight: 500,
						}}
					>
						{step.stepId}
					</span>
					<StepTypeIcon type={step.stepType} />
					<span
						className={`badge ${statusBadgeClass(step.status)}`}
						style={{ marginLeft: "auto" }}
					>
						{step.status}
					</span>
					<span
						style={{
							fontFamily: "var(--font-mono-stack)",
							fontSize: 11,
							color: "var(--text-muted)",
						}}
					>
						{formatDuration(step.durationMs)}
					</span>
					{step.aiTokensUsed ? (
						<span
							style={{
								fontFamily: "var(--font-mono-stack)",
								fontSize: 11,
								color: "var(--text-muted)",
							}}
						>
							{step.aiTokensUsed} tokens
						</span>
					) : null}
				</button>

				{open && (
					<div
						style={{
							borderTop: "1px solid var(--border)",
							padding: 14,
							background: "var(--code-block-bg)",
						}}
					>
						{step.output != null && (
							<>
								<div
									style={{
										fontSize: 10,
										fontWeight: 600,
										textTransform: "uppercase",
										letterSpacing: "0.06em",
										color: "var(--text-muted)",
										marginBottom: 6,
									}}
								>
									Output
								</div>
								<pre
									style={{
										fontFamily: "var(--font-mono-stack)",
										fontSize: 11,
										lineHeight: 1.6,
										whiteSpace: "pre-wrap",
										wordBreak: "break-all",
										margin: 0,
									}}
								>
									{typeof step.output === "string"
										? step.output
										: JSON.stringify(step.output, null, 2)}
								</pre>
							</>
						)}
						{step.error && (
							<>
								<div
									style={{
										fontSize: 10,
										fontWeight: 600,
										textTransform: "uppercase",
										letterSpacing: "0.06em",
										color: "var(--red)",
										marginBottom: 6,
										marginTop: step.output != null ? 12 : 0,
									}}
								>
									Error
								</div>
								<pre
									style={{
										fontFamily: "var(--font-mono-stack)",
										fontSize: 11,
										color: "var(--red)",
										margin: 0,
									}}
								>
									{step.error}
								</pre>
							</>
						)}
						<div
							style={{
								fontSize: 10,
								fontWeight: 600,
								textTransform: "uppercase",
								letterSpacing: "0.06em",
								color: "var(--text-muted)",
								marginBottom: 4,
								marginTop: 12,
							}}
						>
							Timestamps
						</div>
						<div
							style={{
								fontFamily: "var(--font-mono-stack)",
								fontSize: 11,
								color: "var(--text-muted)",
								lineHeight: 1.6,
							}}
						>
							Started: {formatDate(step.startedAt)}
							<br />
							Completed: {formatDate(step.completedAt)}
							{step.retryCount > 0 && (
								<>
									<br />
									Retries: {step.retryCount}
								</>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export default function WorkflowRunDetailPage() {
	const params = useParams<{ name: string; runId: string }>();
	const [run, setRun] = useState<WorkflowRunDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetch(`/api/workflows/runs/${params.runId}`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((data) => setRun(data))
			.catch((e) => setError(e.message))
			.finally(() => setLoading(false));
	}, [params.runId]);

	if (loading) {
		return (
			<>
				<OverviewTopbar page="Loading…" />
				<div style={{ flex: 1, padding: 28, color: "var(--text-muted)" }}>
					Loading run details…
				</div>
			</>
		);
	}

	if (error || !run) {
		return (
			<>
				<OverviewTopbar page="Error" />
				<div style={{ flex: 1, padding: 28, color: "var(--red)" }}>
					{error || "Run not found"}
				</div>
			</>
		);
	}

	const completedSteps = run.steps.filter(
		(s) => s.status === "completed",
	).length;

	return (
		<>
			<OverviewTopbar
				path={
					<>
						<Link
							href="/workflows"
							style={{ color: "inherit", textDecoration: "none" }}
						>
							Workflows
						</Link>
						<span style={{ margin: "0 6px", color: "var(--text-dim)" }}>›</span>
						<Link
							href={`/workflows/${params.name}`}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							{run.workflowName || params.name}
						</Link>
					</>
				}
				page={`Run ${params.runId.slice(0, 8)}`}
			/>
			<div style={{ flex: 1, overflowY: "auto" }}>
				<div className="overview-inner">
					<MetaGrid
						items={[
							{
								label: "Status",
								value: (
									<span className={`badge ${statusBadgeClass(run.status)}`}>
										{run.status}
									</span>
								),
							},
							{
								label: "Duration",
								value: formatDuration(run.durationMs),
								mono: true,
							},
							{
								label: "Steps",
								value: `${completedSteps}/${run.steps.length} completed`,
							},
							{
								label: "AI Tokens",
								value: run.totalAiTokens?.toLocaleString() ?? "—",
								mono: true,
							},
						]}
					/>

					{run.error && (
						<DetailSection title="Error">
							<div
								style={{
									padding: "10px 14px",
									background: "var(--red-bg)",
									border: "1px solid rgba(239,68,68,0.2)",
									borderRadius: 8,
									fontFamily: "var(--font-mono-stack)",
									fontSize: 12,
									color: "var(--red)",
								}}
							>
								{run.error}
							</div>
						</DetailSection>
					)}

					{run.triggerData != null && (
						<DetailSection title="Trigger Data">
							<DetailCodeBlock
								label="INPUT"
								code={
									typeof run.triggerData === "string"
										? run.triggerData
										: JSON.stringify(run.triggerData, null, 2)
								}
								showCopy
							/>
						</DetailSection>
					)}

					<DetailSection title="Steps">
						<div style={{ display: "flex", flexDirection: "column" }}>
							{run.steps
								.sort((a, b) => a.stepIndex - b.stepIndex)
								.map((step) => (
									<StepCard key={step.id} step={step} />
								))}
						</div>
					</DetailSection>
				</div>
			</div>
		</>
	);
}
