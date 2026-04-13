"use client";

import { type CodeTab, TabbedCode } from "@/components/console/tabbed-code";
import type {
	DiffHunk as DiffHunkType,
	WorkflowDiff,
} from "@/lib/sessions/diff-workflow";
import {
	type DynamicToolUIPart,
	type ToolUIPart,
	type UITools,
	getToolName,
} from "ai";
import { useState } from "react";
import { ActionCard } from "./tool-parts/action-card";
import { CodeCard } from "./tool-parts/code-card";
import { DataTableCard } from "./tool-parts/data-table-card";
import { DeploySuccessCard } from "./tool-parts/deploy-success-card";
import { DeployWorkflowCard } from "./tool-parts/deploy-workflow-card";
import { DiagnosticsCard } from "./tool-parts/diagnostics-card";
import { DiffCard } from "./tool-parts/diff-card";
import { InsightsCard } from "./tool-parts/insights-card";
import { KeysCard } from "./tool-parts/keys-card";
import { MemoryRecallCard } from "./tool-parts/memory-tag";
import { StepFlowLive } from "./tool-parts/step-flow-live";
import { StreamStatusCard } from "./tool-parts/stream-status-card";
import { SubgraphStatusCard } from "./tool-parts/subgraph-status-card";
import { SuccessBanner } from "./tool-parts/success-banner";
import { ToolCallIndicator } from "./tool-parts/tool-call-indicator";
import { WorkflowTemplatesCard } from "./tool-parts/workflow-templates-card";

type AnyToolPart = ToolUIPart<UITools> | DynamicToolUIPart;

interface ToolPartRendererProps {
	part: AnyToolPart;
	addToolOutput: (options: {
		toolCallId: string;
		output: unknown;
	}) => void;
}

const HUMAN_IN_LOOP_TOOLS = new Set([
	"manage_streams",
	"manage_keys",
	"manage_subgraphs",
	"deploy_workflow",
	"edit_workflow",
	"rollback_workflow",
]);

export function ToolPartRenderer({
	part,
	addToolOutput,
}: ToolPartRendererProps) {
	const toolName = getToolName(part);
	const state = part.state;

	// Loading state — show indicator with dots
	if (state === "input-streaming") {
		return (
			<ToolCallIndicator toolName={toolName} state={state} input={part.input} />
		);
	}

	// Tools with execute waiting to run — show indicator with dots
	if (state === "input-available" && !HUMAN_IN_LOOP_TOOLS.has(toolName)) {
		return (
			<ToolCallIndicator toolName={toolName} state={state} input={part.input} />
		);
	}

	// rollback_workflow presents a simple confirm card and POSTs /api/workflows/:name/rollback.
	if (state === "input-available" && toolName === "rollback_workflow") {
		const input = part.input as {
			name: string;
			toVersion?: string;
			reason?: string;
		};
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<ActionCard
					action="delete"
					targets={[
						{
							id: input.name,
							name: input.name,
							reason:
								input.reason ??
								(input.toVersion
									? `Restore ${input.toVersion}`
									: "Restore previous version"),
						},
					]}
					onConfirm={async () => {
						try {
							const res = await fetch(`/api/workflows/${input.name}/rollback`, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								credentials: "same-origin",
								body: JSON.stringify(
									input.toVersion ? { toVersion: input.toVersion } : {},
								),
							});
							const body = (await res.json()) as {
								version?: string;
								error?: string;
							};
							addToolOutput({
								toolCallId: part.toolCallId,
								output: res.ok
									? {
											confirmed: true,
											ok: true,
											name: input.name,
											version: body.version,
											message: `Rolled back "${input.name}" to v${body.version}`,
										}
									: {
											confirmed: false,
											ok: false,
											error: body.error ?? `HTTP ${res.status}`,
										},
							});
						} catch (err) {
							addToolOutput({
								toolCallId: part.toolCallId,
								output: {
									confirmed: false,
									ok: false,
									error: err instanceof Error ? err.message : String(err),
								},
							});
						}
					}}
					onCancel={() =>
						addToolOutput({
							toolCallId: part.toolCallId,
							output: {
								confirmed: false,
								message: "Rollback cancelled",
							},
						})
					}
				/>
			</>
		);
	}

	// edit_workflow renders a diff card and runs bundle + deploy with expectedVersion on confirm.
	if (state === "input-available" && toolName === "edit_workflow") {
		const input = part.input as {
			name: string;
			currentCode: string;
			proposedCode: string;
			summary: string;
			expectedVersion: string;
		};
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<EditWorkflowCardWrapper
					input={input}
					onResult={(output) =>
						addToolOutput({
							toolCallId: part.toolCallId,
							output,
						})
					}
				/>
			</>
		);
	}

	// deploy_workflow has a bespoke card that drives the bundle + deploy flow itself.
	if (state === "input-available" && toolName === "deploy_workflow") {
		const input = part.input as {
			name: string;
			code: string;
			triggerSummary: string;
			reason?: string;
			expectedVersion?: string;
		};
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<DeployWorkflowCard
					name={input.name}
					triggerSummary={input.triggerSummary}
					reason={input.reason}
					onConfirm={async (action) => {
						if (action === "cancel") {
							addToolOutput({
								toolCallId: part.toolCallId,
								output: { ok: false, cancelled: true },
							});
							return;
						}
						const result = await bundleAndDeployWorkflow({
							code: input.code,
							expectedVersion: input.expectedVersion,
						});
						addToolOutput({
							toolCallId: part.toolCallId,
							output: result,
						});
					}}
				/>
			</>
		);
	}

	// Human-in-the-loop tools — show indicator + action card
	if (state === "input-available" && HUMAN_IN_LOOP_TOOLS.has(toolName)) {
		const input = part.input as {
			action: string;
			targets: Array<{ id?: string; name: string; reason?: string }>;
		};
		const resourceType =
			toolName === "manage_keys"
				? "keys"
				: toolName === "manage_subgraphs"
					? "subgraphs"
					: "streams";
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<ActionCard
					action={input.action}
					targets={input.targets.map((t) => ({
						id: t.id ?? t.name,
						name: t.name,
						reason: t.reason,
					}))}
					onConfirm={async () => {
						await executeAction(toolName, input.action, input.targets);
						addToolOutput({
							toolCallId: part.toolCallId,
							output: {
								confirmed: true,
								message: `${input.targets.length} ${resourceType} ${input.action}d successfully`,
							},
						});
					}}
					onCancel={() =>
						addToolOutput({
							toolCallId: part.toolCallId,
							output: { confirmed: false, message: "Action cancelled by user" },
						})
					}
				/>
			</>
		);
	}

	// Output states — show indicator + result card (if applicable)
	if (state === "output-available") {
		const output = part.output as Record<string, unknown>;
		const indicator = (
			<ToolCallIndicator
				toolName={toolName}
				state={state}
				input={part.input}
				output={output}
			/>
		);

		const card = renderOutputCard(toolName, output);

		return (
			<>
				{indicator}
				{card}
			</>
		);
	}

	// Error state
	if (state === "output-error") {
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<div className="tool-error">
					Tool error:{" "}
					{(part as { errorText?: string }).errorText ?? "Unknown error"}
				</div>
			</>
		);
	}

	return null;
}

/** Render the visible card for a tool output, or null for invisible tools */
function renderOutputCard(toolName: string, output: Record<string, unknown>) {
	switch (toolName) {
		case "check_subgraphs":
			return (
				<SubgraphStatusCard
					subgraphs={
						output.subgraphs as Array<{
							name: string;
							status: string;
							lastProcessedBlock: number | null;
							totalProcessed: number;
							totalErrors: number;
						}>
					}
				/>
			);

		case "check_streams":
			return (
				<StreamStatusCard
					streams={
						output.streams as Array<{
							id: string;
							name: string;
							status: string;
							enabled: boolean;
							totalDeliveries: number;
							failedDeliveries: number;
							errorMessage: string | null;
						}>
					}
				/>
			);

		case "check_keys":
			return (
				<KeysCard
					keys={
						output.keys as Array<{
							id: string;
							name: string;
							prefix: string;
							status: string;
							lastUsedAt: string | null;
							createdAt: string;
						}>
					}
				/>
			);

		case "check_insights":
			return (
				<InsightsCard
					insights={
						output.insights as Array<{
							id: string;
							severity: "info" | "warning" | "danger";
							title: string;
							body: string;
							category: string;
						}>
					}
				/>
			);

		case "manage_streams":
		case "manage_keys":
		case "manage_subgraphs": {
			const msg = (output as { message?: string }).message;
			if ((output as { confirmed?: boolean }).confirmed === false) {
				return <SuccessBanner message={msg ?? "Action cancelled"} />;
			}
			return <SuccessBanner message={msg ?? "Action completed"} />;
		}

		case "scaffold_subgraph": {
			if ((output as { error?: boolean }).error) return null;
			const o = output as {
				code: string;
				html?: string;
				filename?: string;
			};
			return <CodeCard code={o.code} html={o.html} filename={o.filename} />;
		}

		case "scaffold_workflow": {
			if ((output as { error?: boolean }).error) return null;
			const o = output as {
				code: string;
				html?: string;
				filename?: string;
			};
			return <CodeCard code={o.code} html={o.html} filename={o.filename} />;
		}

		case "list_workflow_templates": {
			const templates = (output.templates ?? []) as Array<{
				id: string;
				name: string;
				description: string;
				category: string;
				trigger: string;
				prompt: string;
			}>;
			if (templates.length === 0) return null;
			return <WorkflowTemplatesCard templates={templates} />;
		}

		case "deploy_workflow": {
			const o = output as {
				ok?: boolean;
				cancelled?: boolean;
				name?: string;
				version?: string;
				error?: string;
			};
			if (!o.ok) {
				return (
					<SuccessBanner
						message={
							o.cancelled ? "Deploy cancelled" : (o.error ?? "Deploy failed")
						}
					/>
				);
			}
			if (!o.name || !o.version) return null;
			return <DeploySuccessCardWrapper name={o.name} version={o.version} />;
		}

		case "edit_workflow": {
			const o = output as {
				ok?: boolean;
				cancelled?: boolean;
				name?: string;
				version?: string;
				error?: string;
			};
			if (!o.ok) {
				return (
					<SuccessBanner
						message={
							o.cancelled ? "Edit cancelled" : (o.error ?? "Edit failed")
						}
					/>
				);
			}
			if (!o.name || !o.version) return null;
			return <DeploySuccessCardWrapper name={o.name} version={o.version} />;
		}

		case "tail_workflow_run": {
			if ((output as { error?: boolean }).error) return null;
			const o = output as { name?: string; runId?: string };
			if (!o.name || !o.runId) return null;
			return <StepFlowLive workflowName={o.name} runId={o.runId} />;
		}

		case "read_workflow": {
			if ((output as { error?: boolean }).error) return null;
			if ((output as { readOnly?: boolean }).readOnly) {
				const o = output as { name?: string; reason?: string };
				return (
					<SuccessBanner
						message={`${o.name ?? "Workflow"} is read-only — ${o.reason ?? "redeploy via CLI to enable chat edits"}`}
					/>
				);
			}
			const o = output as {
				sourceCode?: string;
				html?: string;
				filename?: string;
			};
			if (!o.sourceCode) return null;
			return (
				<CodeCard code={o.sourceCode} html={o.html} filename={o.filename} />
			);
		}

		case "recall_sessions": {
			const sessions = (output.sessions ?? []) as Array<{
				id: string;
				title: string | null;
				createdAt: string;
				summary: string;
			}>;
			return <MemoryRecallCard sessions={sessions} />;
		}

		case "query_subgraph": {
			const rows = (output.rows ?? []) as Array<Record<string, unknown>>;
			return (
				<DataTableCard
					subgraph={output.subgraph as string}
					table={output.table as string}
					rows={rows}
					meta={output.meta as { total?: number } | undefined}
				/>
			);
		}

		case "diagnose": {
			const findings = (output.findings ?? []) as Array<{
				resource: string;
				resourceType: string;
				severity: "danger" | "warning" | "info";
				title: string;
				description: string;
				suggestion: string;
			}>;
			return <DiagnosticsCard findings={findings} />;
		}

		case "show_code": {
			if ((output as { error?: boolean }).error) return null;
			const tabs = (output.tabs ?? []) as CodeTab[];
			if (tabs.length === 0) return null;
			return <TabbedCode tabs={tabs} />;
		}

		// lookup_docs, check_usage — invisible tools, indicator only
		default:
			return null;
	}
}

async function executeAction(
	toolName: string,
	action: string,
	targets: Array<{ id?: string; name: string }>,
) {
	const calls: Promise<Response>[] = [];

	for (const t of targets) {
		switch (toolName) {
			case "manage_streams": {
				const pathMap: Record<string, { method: string; path: string }> = {
					pause: { method: "POST", path: `/api/streams/${t.id}/pause` },
					resume: { method: "POST", path: `/api/streams/${t.id}/resume` },
					delete: { method: "DELETE", path: `/api/streams/${t.id}` },
					"replay-failed": {
						method: "POST",
						path: `/api/streams/${t.id}/replay-failed`,
					},
				};
				const call = pathMap[action];
				if (call)
					calls.push(
						fetch(call.path, {
							method: call.method,
							credentials: "same-origin",
						}),
					);
				break;
			}
			case "manage_keys": {
				if (action === "revoke") {
					calls.push(
						fetch(`/api/keys/${t.id}`, {
							method: "DELETE",
							credentials: "same-origin",
						}),
					);
				}
				break;
			}
			case "manage_subgraphs": {
				const pathMap: Record<string, { method: string; path: string }> = {
					reindex: { method: "POST", path: `/api/subgraphs/${t.name}/reindex` },
					delete: { method: "DELETE", path: `/api/subgraphs/${t.name}` },
					stop: { method: "POST", path: `/api/subgraphs/${t.name}/stop` },
				};
				const call = pathMap[action];
				if (call)
					calls.push(
						fetch(call.path, {
							method: call.method,
							credentials: "same-origin",
						}),
					);
				break;
			}
		}
	}

	await Promise.allSettled(calls);
}

type BundleWorkflowResult = {
	ok: boolean;
	name?: string;
	trigger?: Record<string, unknown>;
	handlerCode?: string;
	sourceCode?: string;
	retries?: Record<string, unknown> | null;
	timeout?: number | null;
	error?: string;
	actualBytes?: number;
	maxBytes?: number;
};

type DeployWorkflowResponse = {
	action: "created" | "updated";
	workflowId: string;
	version: string;
	message: string;
};

async function bundleAndDeployWorkflow(input: {
	code: string;
	expectedVersion?: string;
}): Promise<{
	ok: boolean;
	name?: string;
	version?: string;
	workflowId?: string;
	error?: string;
}> {
	let bundled: BundleWorkflowResult;
	try {
		const bundleRes = await fetch("/api/sessions/bundle-workflow", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ code: input.code }),
		});
		bundled = (await bundleRes.json()) as BundleWorkflowResult;
		if (!bundleRes.ok || !bundled.ok) {
			return {
				ok: false,
				error: bundled.error ?? `Bundle failed (HTTP ${bundleRes.status})`,
			};
		}
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	if (!bundled.name || !bundled.handlerCode) {
		return { ok: false, error: "Bundler returned an incomplete response" };
	}

	try {
		const deployRes = await fetch("/api/workflows", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-sl-origin": "session",
			},
			credentials: "same-origin",
			body: JSON.stringify({
				name: bundled.name,
				trigger: bundled.trigger,
				handlerCode: bundled.handlerCode,
				sourceCode: bundled.sourceCode,
				retries: bundled.retries ?? undefined,
				timeout: bundled.timeout ?? undefined,
				...(input.expectedVersion
					? { expectedVersion: input.expectedVersion }
					: {}),
			}),
		});
		const deployBody = (await deployRes.json()) as
			| DeployWorkflowResponse
			| { error?: string; currentVersion?: string };
		if (!deployRes.ok) {
			const msg =
				(deployBody as { error?: string }).error ??
				`Deploy failed (HTTP ${deployRes.status})`;
			return { ok: false, error: msg };
		}
		const ok = deployBody as DeployWorkflowResponse;
		return {
			ok: true,
			name: bundled.name,
			version: ok.version,
			workflowId: ok.workflowId,
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

function DeploySuccessCardWrapper({
	name,
	version,
}: {
	name: string;
	version: string;
}) {
	const [testRunSent, setTestRunSent] = useState(false);
	const [runId, setRunId] = useState<string | null>(null);
	const [tailOpen, setTailOpen] = useState(false);
	const [tailError, setTailError] = useState<string | null>(null);

	const startTail = async () => {
		if (tailOpen) return;
		setTailError(null);
		let targetRunId = runId;
		if (!targetRunId) {
			// No test run has fired yet — trigger one so there's something to tail.
			try {
				const res = await fetch(`/api/workflows/${name}/trigger`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "same-origin",
					body: "{}",
				});
				if (!res.ok) {
					setTailError(`Failed to trigger run (HTTP ${res.status})`);
					return;
				}
				const body = (await res.json()) as { runId?: string };
				if (!body.runId) {
					setTailError("Trigger succeeded but returned no runId");
					return;
				}
				targetRunId = body.runId;
				setRunId(targetRunId);
				setTestRunSent(true);
			} catch (err) {
				setTailError(err instanceof Error ? err.message : String(err));
				return;
			}
		}
		setTailOpen(true);
	};

	return (
		<DeploySuccessCard
			name={name}
			version={version}
			testRunSent={testRunSent}
			tailOpen={tailOpen}
			tail={
				tailOpen && runId ? (
					<StepFlowLive workflowName={name} runId={runId} />
				) : tailError ? (
					<div className="tool-error-body">{tailError}</div>
				) : undefined
			}
			onTrigger={async () => {
				if (testRunSent) return;
				setTestRunSent(true);
				try {
					const res = await fetch(`/api/workflows/${name}/trigger`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: "{}",
					});
					if (res.ok) {
						const body = (await res.json()) as { runId?: string };
						if (body.runId) setRunId(body.runId);
					}
				} catch {
					setTestRunSent(false);
				}
			}}
			onTail={startTail}
		/>
	);
}

type EditWorkflowInput = {
	name: string;
	currentCode: string;
	proposedCode: string;
	summary: string;
	expectedVersion: string;
};

type EditWorkflowResult = {
	ok: boolean;
	cancelled?: boolean;
	name?: string;
	version?: string;
	error?: string;
};

async function fetchDiff(input: EditWorkflowInput): Promise<WorkflowDiff> {
	const res = await fetch("/api/sessions/diff-workflow", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({
			name: input.name,
			currentCode: input.currentCode,
			proposedCode: input.proposedCode,
		}),
	});
	if (!res.ok) {
		throw new Error(`Diff failed (HTTP ${res.status})`);
	}
	return (await res.json()) as WorkflowDiff;
}

function EditWorkflowCardWrapper({
	input,
	onResult,
}: {
	input: EditWorkflowInput;
	onResult: (result: EditWorkflowResult) => void;
}) {
	const [hunks, setHunks] = useState<DiffHunkType[] | null>(null);
	const [added, setAdded] = useState(0);
	const [removed, setRemoved] = useState(0);
	const [busy, setBusy] = useState(false);
	const [staleVersion, setStaleVersion] = useState<string | undefined>();
	const [errorText, setErrorText] = useState<string | undefined>();

	// Fetch diff once on mount.
	useState(() => {
		void (async () => {
			try {
				const diff = await fetchDiff(input);
				setHunks(diff.hunks);
				setAdded(diff.added);
				setRemoved(diff.removed);
			} catch (err) {
				setErrorText(err instanceof Error ? err.message : String(err));
				setHunks([]);
			}
		})();
	});

	if (hunks === null) {
		return <div className="tool-card-loading">Computing diff…</div>;
	}

	return (
		<DiffCard
			name={input.name}
			summary={input.summary}
			hunks={hunks}
			added={added}
			removed={removed}
			busy={busy}
			staleVersion={staleVersion}
			errorText={errorText}
			onCancel={() => onResult({ ok: false, cancelled: true })}
			onConfirm={async () => {
				setBusy(true);
				setErrorText(undefined);
				setStaleVersion(undefined);
				const result = await bundleAndDeployWorkflow({
					code: input.proposedCode,
					expectedVersion: input.expectedVersion,
				});
				if (!result.ok && result.error?.toLowerCase().includes("version")) {
					const match = result.error.match(/current\s+(\d+\.\d+\.\d+)/i);
					setStaleVersion(match?.[1] ?? "?");
					setErrorText(result.error);
					setBusy(false);
					onResult({ ok: false, error: result.error });
					return;
				}
				setBusy(false);
				onResult({
					ok: result.ok,
					name: result.name,
					version: result.version,
					error: result.error,
				});
			}}
		/>
	);
}
