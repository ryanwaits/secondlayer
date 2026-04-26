"use client";

import { type CodeTab, TabbedCode } from "@/components/console/tabbed-code";
import type {
	DiffHunk as DiffHunkType,
	UnifiedDiff,
} from "@/lib/sessions/diff";
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
import { DeploySubgraphCard } from "./tool-parts/deploy-subgraph-card";
import { DiagnosticsCard } from "./tool-parts/diagnostics-card";
import { DiffCard } from "./tool-parts/diff-card";
import { InsightsCard } from "./tool-parts/insights-card";
import { KeysCard } from "./tool-parts/keys-card";
import { MemoryRecallCard } from "./tool-parts/memory-tag";
import { SignedTestFixtureCard } from "./tool-parts/signed-test-fixture-card";
import { SubgraphStatusCard } from "./tool-parts/subgraph-status-card";
import { SubgraphSyncLive } from "./tool-parts/subgraph-sync-live";
import { SubscriptionCreateCard } from "./tool-parts/subscription-create-card";
import { SubscriptionDeliveryCard } from "./tool-parts/subscription-delivery-card";
import { SubscriptionDiagnosticsCard } from "./tool-parts/subscription-diagnostics-card";
import { SubscriptionSecretCard } from "./tool-parts/subscription-secret-card";
import { SubscriptionStatusCard } from "./tool-parts/subscription-status-card";
import { SuccessBanner } from "./tool-parts/success-banner";
import { ToolCallIndicator } from "./tool-parts/tool-call-indicator";

type AnyToolPart = ToolUIPart<UITools> | DynamicToolUIPart;

interface ToolPartRendererProps {
	part: AnyToolPart;
	addToolOutput: (options: {
		toolCallId: string;
		output: unknown;
	}) => void;
}

const HUMAN_IN_LOOP_TOOLS = new Set([
	"manage_keys",
	"manage_subgraphs",
	"manage_subscriptions",
	"create_subscription",
	"requeue_dead_subscription",
	"deploy_subgraph",
	"edit_subgraph",
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

	// deploy_subgraph drives the subgraph bundle + deploy path.
	if (state === "input-available" && toolName === "deploy_subgraph") {
		const input = part.input as {
			name: string;
			code: string;
			description: string;
			reason?: string;
		};
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<DeploySubgraphCard
					name={input.name}
					description={input.description}
					reason={input.reason}
					onConfirm={async (action) => {
						if (action === "cancel") {
							addToolOutput({
								toolCallId: part.toolCallId,
								output: { ok: false, cancelled: true },
							});
							return;
						}
						const result = await bundleAndDeploySubgraph({
							code: input.code,
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

	// edit_subgraph renders a DiffCard and runs bundle + deploy on confirm.
	if (state === "input-available" && toolName === "edit_subgraph") {
		const input = part.input as {
			name: string;
			currentCode: string;
			proposedCode: string;
			summary: string;
		};
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<EditSubgraphCardWrapper
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

	if (state === "input-available" && toolName === "create_subscription") {
		const input = part.input as SubscriptionCreateInput;
		return (
			<>
				<ToolCallIndicator
					toolName={toolName}
					state={state}
					input={part.input}
				/>
				<SubscriptionCreateCard
					input={input}
					onConfirm={async () => {
						const result = await executeCreateSubscription(input);
						addToolOutput({
							toolCallId: part.toolCallId,
							output: result,
						});
					}}
					onCancel={() =>
						addToolOutput({
							toolCallId: part.toolCallId,
							output: {
								confirmed: false,
								cancelled: true,
								message: "Subscription creation cancelled",
							},
						})
					}
				/>
			</>
		);
	}

	if (state === "input-available" && toolName === "requeue_dead_subscription") {
		const input = part.input as {
			subscriptionId: string;
			subscriptionName: string;
			outboxId: string;
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
					action="requeue"
					targets={[
						{
							id: input.outboxId,
							name: `${input.subscriptionName} · ${input.outboxId}`,
							reason: input.reason,
						},
					]}
					onConfirm={async () => {
						const result = await executeRequeueDeadSubscription(input);
						addToolOutput({
							toolCallId: part.toolCallId,
							output: result,
						});
					}}
					onCancel={() =>
						addToolOutput({
							toolCallId: part.toolCallId,
							output: { confirmed: false, message: "Requeue cancelled" },
						})
					}
				/>
			</>
		);
	}

	// Human-in-the-loop tools — show indicator + action card
	if (state === "input-available" && HUMAN_IN_LOOP_TOOLS.has(toolName)) {
		const input = part.input as {
			action: string;
			targets: ActionTargetInput[];
			triggerInput?: string;
		};
		const resourceType =
			toolName === "manage_keys"
				? "keys"
				: toolName === "manage_subscriptions"
					? "subscriptions"
					: "subgraphs";
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
						const result = await executeAction(
							toolName,
							input.action,
							input.targets,
						);
						addToolOutput({
							toolCallId: part.toolCallId,
							output: result ?? {
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
							totalRows?: number;
							totalErrors: number;
						}>
					}
				/>
			);

		case "check_subscriptions":
			return (
				<SubscriptionStatusCard
					subscriptions={
						output.subscriptions as Array<{
							id: string;
							name: string;
							status: string;
							target: string;
							format: string;
							runtime: string | null;
							lastDeliveryAt: string | null;
							lastSuccessAt: string | null;
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

		case "manage_keys":
		case "manage_subgraphs":
		case "manage_subscriptions":
		case "requeue_dead_subscription":
		case "create_subscription": {
			const msg = (output as { message?: string }).message;
			const errored = (output as { error?: string }).error;
			if (errored) {
				return <SuccessBanner tone="error" message={errored} />;
			}
			if ((output as { confirmed?: boolean }).confirmed === false) {
				return (
					<SuccessBanner tone="info" message={msg ?? "Action cancelled"} />
				);
			}
			const secret = toSecretCardData(output);
			if (secret.length > 0) {
				return (
					<>
						<SuccessBanner message={msg ?? "Action completed"} />
						<SubscriptionSecretCard secrets={secret} />
					</>
				);
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

		case "tail_subgraph_sync": {
			if ((output as { error?: boolean }).error) return null;
			const o = output as { name?: string };
			if (!o.name) return null;
			return <SubgraphSyncLive name={o.name} />;
		}

		case "deploy_subgraph": {
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
						tone={o.cancelled ? "info" : "error"}
						message={
							o.cancelled ? "Deploy cancelled" : (o.error ?? "Deploy failed")
						}
					/>
				);
			}
			if (!o.name) return null;
			return (
				<SuccessBanner
					message={`Deployed ${o.name}${o.version ? ` → v${o.version}` : ""}`}
				/>
			);
		}

		case "edit_subgraph": {
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
						tone={o.cancelled ? "info" : "error"}
						message={
							o.cancelled ? "Edit cancelled" : (o.error ?? "Edit failed")
						}
					/>
				);
			}
			if (!o.name) return null;
			return (
				<SuccessBanner
					message={`Updated ${o.name}${o.version ? ` → v${o.version}` : ""}`}
				/>
			);
		}

		case "read_subgraph": {
			if ((output as { error?: boolean }).error) return null;
			if ((output as { readOnly?: boolean }).readOnly) {
				const o = output as { name?: string; reason?: string };
				return (
					<SuccessBanner
						message={`${o.name ?? "Subgraph"} is read-only — ${o.reason ?? "redeploy via CLI to enable chat edits"}`}
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

		case "diagnose_subscription": {
			const subscription = output.subscription as {
				name: string;
				status: string;
				subgraphName?: string;
				tableName?: string;
			};
			return (
				<>
					<SubscriptionDiagnosticsCard
						subscription={{
							name: subscription.name,
							status: subscription.status,
							target:
								subscription.subgraphName && subscription.tableName
									? `${subscription.subgraphName}.${subscription.tableName}`
									: undefined,
						}}
						deliverySummary={
							output.deliverySummary as {
								total: number;
								successful: number;
								failed: number;
								last: {
									statusCode: number | null;
									dispatchedAt: string;
								} | null;
							}
						}
						findings={
							output.findings as Array<{
								resource: string;
								resourceType: string;
								severity: "danger" | "warning" | "info";
								title: string;
								description: string;
								suggestion: string;
							}>
						}
					/>
					<SubscriptionDeliveryCard
						deliveries={
							(output.deliveries ?? []) as Array<{
								id: string;
								attempt: number;
								statusCode: number | null;
								errorMessage: string | null;
								durationMs: number | null;
								dispatchedAt: string;
							}>
						}
						deadRows={
							(output.deadRows ?? []) as Array<{
								id: string;
								eventType: string;
								attempt: number;
								blockHeight: number;
								failedAt: string | null;
							}>
						}
					/>
				</>
			);
		}

		case "test_subscription": {
			return (
				<SignedTestFixtureCard
					subscription={
						output.subscription as {
							name: string;
							target: string;
							url: string;
						}
					}
					body={output.body as string}
					headers={output.headers as Record<string, string>}
					curl={output.curl as string}
				/>
			);
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

interface ActionTargetInput {
	id?: string;
	name: string;
	reason?: string;
	fromBlock?: number;
	toBlock?: number;
}

interface SubscriptionCreateInput {
	name: string;
	subgraphName: string;
	tableName: string;
	url: string;
	format?: string;
	runtime?: string | null;
	filter?: Record<string, unknown>;
	reason?: string;
}

function toSecretCardData(output: Record<string, unknown>) {
	const secrets: Array<{
		subscriptionName: string;
		subscriptionId: string;
		signingSecret: string;
	}> = [];
	const signingSecret = output.signingSecret;
	const subscription = output.subscription as
		| { id?: string; name?: string }
		| undefined;
	if (
		typeof signingSecret === "string" &&
		typeof subscription?.id === "string" &&
		typeof subscription?.name === "string"
	) {
		secrets.push({
			subscriptionId: subscription.id,
			subscriptionName: subscription.name,
			signingSecret,
		});
	}

	const rotated = output.rotatedSecrets;
	if (Array.isArray(rotated)) {
		for (const item of rotated) {
			const row = item as {
				subscriptionId?: string;
				subscriptionName?: string;
				signingSecret?: string;
			};
			if (row.subscriptionId && row.subscriptionName && row.signingSecret) {
				secrets.push({
					subscriptionId: row.subscriptionId,
					subscriptionName: row.subscriptionName,
					signingSecret: row.signingSecret,
				});
			}
		}
	}
	return secrets;
}

async function executeCreateSubscription(input: SubscriptionCreateInput) {
	const res = await fetch("/api/subscriptions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({
			name: input.name,
			subgraphName: input.subgraphName,
			tableName: input.tableName,
			url: input.url,
			format: input.format ?? "standard-webhooks",
			runtime: input.runtime ?? null,
			filter: input.filter ?? {},
		}),
	});
	const body = (await res.json().catch(() => ({}))) as {
		error?: string;
		subscription?: { id: string; name: string };
		signingSecret?: string;
	};
	if (!res.ok) {
		return {
			confirmed: false,
			error: body.error ?? `Create failed (HTTP ${res.status})`,
		};
	}
	return {
		confirmed: true,
		message: `Created subscription ${body.subscription?.name ?? input.name}`,
		...body,
	};
}

async function executeRequeueDeadSubscription(input: {
	subscriptionId: string;
	subscriptionName: string;
	outboxId: string;
}) {
	const res = await fetch(
		`/api/subscriptions/${input.subscriptionId}/dead/${input.outboxId}/requeue`,
		{ method: "POST", credentials: "same-origin" },
	);
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	if (!res.ok) {
		return {
			confirmed: false,
			error: body.error ?? `Requeue failed (HTTP ${res.status})`,
		};
	}
	return {
		confirmed: true,
		message: `Requeued ${input.outboxId} for ${input.subscriptionName}`,
	};
}

async function executeAction(
	toolName: string,
	action: string,
	targets: ActionTargetInput[],
) {
	const rotatedSecrets: Array<{
		subscriptionId: string;
		subscriptionName: string;
		signingSecret: string;
	}> = [];
	const errors: string[] = [];
	let successCount = 0;

	for (const t of targets) {
		switch (toolName) {
			case "manage_keys": {
				if (action === "revoke") {
					const result = await callJson(`/api/keys/${t.id}`, {
						method: "DELETE",
					});
					if (result.ok) successCount++;
					else errors.push(result.error);
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
				if (call) {
					const result = await callJson(call.path, { method: call.method });
					if (result.ok) successCount++;
					else errors.push(result.error);
				}
				break;
			}
			case "manage_subscriptions": {
				if (!t.id) {
					errors.push(`Missing subscription id for ${t.name}`);
					break;
				}
				const call = subscriptionActionRequest(action, t);
				if (!call) {
					errors.push(`Unsupported subscription action: ${action}`);
					break;
				}
				const result = await callJson(call.path, {
					method: call.method,
					body: call.body,
				});
				if (!result.ok) {
					errors.push(result.error);
					break;
				}
				successCount++;
				const body = result.body as {
					subscription?: { id: string; name: string };
					signingSecret?: string;
				};
				if (action === "rotate-secret" && body.signingSecret) {
					rotatedSecrets.push({
						subscriptionId: body.subscription?.id ?? t.id,
						subscriptionName: body.subscription?.name ?? t.name,
						signingSecret: body.signingSecret,
					});
				}
				break;
			}
		}
	}

	if (errors.length > 0) {
		return {
			confirmed: false,
			error: errors.join("; "),
		};
	}

	return {
		confirmed: true,
		message: `${successCount} ${toolName === "manage_subscriptions" ? "subscription" : toolName === "manage_keys" ? "key" : "subgraph"}${successCount === 1 ? "" : "s"} ${action} completed`,
		rotatedSecrets,
	};
}

async function callJson(
	path: string,
	options: { method: string; body?: unknown },
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
	const res = await fetch(path, {
		method: options.method,
		credentials: "same-origin",
		headers:
			options.body !== undefined
				? { "Content-Type": "application/json" }
				: undefined,
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
	});
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	if (!res.ok) {
		return {
			ok: false,
			error: body.error ?? `HTTP ${res.status}`,
		};
	}
	return { ok: true, body };
}

function subscriptionActionRequest(action: string, target: ActionTargetInput) {
	switch (action) {
		case "pause":
		case "resume":
			return {
				method: "POST",
				path: `/api/subscriptions/${target.id}/${action}`,
			};
		case "delete":
			return { method: "DELETE", path: `/api/subscriptions/${target.id}` };
		case "rotate-secret":
			return {
				method: "POST",
				path: `/api/subscriptions/${target.id}/rotate-secret`,
			};
		case "replay":
			if (target.fromBlock == null || target.toBlock == null) return null;
			return {
				method: "POST",
				path: `/api/subscriptions/${target.id}/replay`,
				body: {
					fromBlock: target.fromBlock,
					toBlock: target.toBlock,
				},
			};
		default:
			return null;
	}
}

type BundleSubgraphResult = {
	ok: boolean;
	name?: string;
	version?: string | null;
	description?: string | null;
	sources?: Record<string, Record<string, unknown>>;
	schema?: Record<string, unknown>;
	handlerCode?: string;
	sourceCode?: string;
	error?: string;
	actualBytes?: number;
	maxBytes?: number;
};

type DeploySubgraphResponse = {
	action: "created" | "unchanged" | "updated" | "reindexed";
	subgraphId: string;
	version: string;
	message: string;
};

async function bundleAndDeploySubgraph(input: { code: string }): Promise<{
	ok: boolean;
	name?: string;
	version?: string;
	subgraphId?: string;
	error?: string;
}> {
	let bundled: BundleSubgraphResult;
	try {
		const bundleRes = await fetch("/api/sessions/bundle-subgraph", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ code: input.code }),
		});
		bundled = (await bundleRes.json()) as BundleSubgraphResult;
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

	if (
		!bundled.name ||
		!bundled.handlerCode ||
		!bundled.sources ||
		!bundled.schema
	) {
		return { ok: false, error: "Bundler returned an incomplete response" };
	}

	try {
		const deployRes = await fetch("/api/subgraphs", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-sl-origin": "session",
			},
			credentials: "same-origin",
			body: JSON.stringify({
				name: bundled.name,
				version: bundled.version ?? undefined,
				description: bundled.description ?? undefined,
				sources: bundled.sources,
				schema: bundled.schema,
				handlerCode: bundled.handlerCode,
				sourceCode: bundled.sourceCode,
			}),
		});
		const deployBody = (await deployRes.json()) as
			| DeploySubgraphResponse
			| { error?: string | Record<string, unknown> };
		if (!deployRes.ok) {
			const rawErr = (deployBody as { error?: unknown }).error;
			const msg =
				typeof rawErr === "string"
					? rawErr
					: rawErr
						? JSON.stringify(rawErr)
						: `Deploy failed (HTTP ${deployRes.status})`;
			return { ok: false, error: msg };
		}
		const ok = deployBody as DeploySubgraphResponse;
		return {
			ok: true,
			name: bundled.name,
			version: ok.version,
			subgraphId: ok.subgraphId,
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

type EditSubgraphInput = {
	name: string;
	currentCode: string;
	proposedCode: string;
	summary: string;
};

type EditSubgraphResult = {
	ok: boolean;
	cancelled?: boolean;
	name?: string;
	version?: string;
	error?: string;
};

async function fetchSubgraphDiff(
	input: EditSubgraphInput,
): Promise<UnifiedDiff> {
	const res = await fetch("/api/sessions/diff-subgraph", {
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
	return (await res.json()) as UnifiedDiff;
}

function EditSubgraphCardWrapper({
	input,
	onResult,
}: {
	input: EditSubgraphInput;
	onResult: (result: EditSubgraphResult) => void;
}) {
	const [hunks, setHunks] = useState<DiffHunkType[] | null>(null);
	const [added, setAdded] = useState(0);
	const [removed, setRemoved] = useState(0);
	const [busy, setBusy] = useState(false);
	const [errorText, setErrorText] = useState<string | undefined>();

	useState(() => {
		void (async () => {
			try {
				const diff = await fetchSubgraphDiff(input);
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
			errorText={errorText}
			onCancel={() => onResult({ ok: false, cancelled: true })}
			onConfirm={async () => {
				setBusy(true);
				setErrorText(undefined);
				const result = await bundleAndDeploySubgraph({
					code: input.proposedCode,
				});
				setBusy(false);
				if (!result.ok) {
					setErrorText(result.error);
					onResult({ ok: false, error: result.error });
					return;
				}
				onResult({
					ok: true,
					name: result.name,
					version: result.version,
				});
			}}
		/>
	);
}
