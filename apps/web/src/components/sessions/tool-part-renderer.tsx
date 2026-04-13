"use client";

import { type CodeTab, TabbedCode } from "@/components/console/tabbed-code";
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
import { InsightsCard } from "./tool-parts/insights-card";
import { KeysCard } from "./tool-parts/keys-card";
import { MemoryRecallCard } from "./tool-parts/memory-tag";
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
	return (
		<DeploySuccessCard
			name={name}
			version={version}
			testRunSent={testRunSent}
			onTrigger={async () => {
				if (testRunSent) return;
				setTestRunSent(true);
				try {
					await fetch(`/api/workflows/${name}/trigger`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						credentials: "same-origin",
						body: "{}",
					});
				} catch {
					setTestRunSent(false);
				}
			}}
			onTail={() => {
				// Tail CTA wiring lands in Sprint 5 (T5.6).
			}}
		/>
	);
}
