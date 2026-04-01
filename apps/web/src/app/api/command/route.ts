import { actions } from "@/lib/actions/registry";
import { apiRequest, getSessionFromRequest } from "@/lib/api";
import { createCommandAgent } from "@/lib/command/agent";
import type { CommandRequest, CommandResponse } from "@/lib/command/types";
import { triageStreams, triageSubgraphs } from "@/lib/intelligence/dashboard";
import type { ApiKey, Stream, SubgraphSummary } from "@/lib/types";
import { NextResponse } from "next/server";

function buildInstructions(
	path: string,
	streams: Stream[],
	subgraphs: SubgraphSummary[],
	keys: ApiKey[],
	chainTip: number | null,
) {
	const actionList = actions
		.map(
			(a) =>
				`- ${a.id}: "${a.label}" [${a.category}] keywords: ${a.keywords.join(", ")}`,
		)
		.join("\n");

	const streamList = streams.length
		? streams
				.map(
					(s) =>
						`- id:${s.id} name:"${s.name}" status:${s.status} enabled:${s.enabled} failed:${s.failedDeliveries}`,
				)
				.join("\n")
		: "No streams.";

	const subgraphList = subgraphs.length
		? subgraphs.map((v) => `- name:"${v.name}" status:${v.status}`).join("\n")
		: "No subgraphs.";

	const keyList = keys.length
		? keys
				.map(
					(k) =>
						`- id:${k.id} prefix:${k.prefix} name:"${k.name}" status:${k.status}`,
				)
				.join("\n")
		: "No API keys.";

	// Build page context awareness
	let pageContext = "";
	const detailMatch = path.match(/\/(streams|subgraphs)\/([^/]+)/);
	if (detailMatch) {
		const [, resourceType, resourceId] = detailMatch;
		if (resourceType === "streams") {
			const stream = streams.find((s) => s.id === resourceId);
			if (stream) {
				const issues: string[] = [];
				if (stream.status === "failed")
					issues.push(
						`Stream is **failed**${stream.errorMessage ? `: ${stream.errorMessage}` : ""}`,
					);
				if (
					stream.totalDeliveries > 0 &&
					stream.failedDeliveries / stream.totalDeliveries > 0.1
				) {
					issues.push(
						`High failure rate: ${((stream.failedDeliveries / stream.totalDeliveries) * 100).toFixed(0)}%`,
					);
				}
				if (stream.status === "paused") issues.push("Stream is **paused**");
				if (issues.length > 0) {
					pageContext = `\n\n## Current resource health\nUser is viewing stream "${stream.name}" (${stream.id}):\n${issues.map((i) => `- ${i}`).join("\n")}\nProactively mention these issues if the query is related.`;
				} else {
					pageContext = `\n\n## Current resource\nUser is viewing stream "${stream.name}" (${stream.id}), status: ${stream.status}`;
				}
			}
		} else if (resourceType === "subgraphs") {
			const subgraph = subgraphs.find((s) => s.name === resourceId);
			if (subgraph) {
				const issues: string[] = [];
				if (subgraph.status === "error")
					issues.push("Subgraph is in **error** state");
				if (chainTip != null && subgraph.lastProcessedBlock != null) {
					const behind = chainTip - subgraph.lastProcessedBlock;
					if (behind > 50)
						issues.push(
							`Subgraph is **stalled** — ${behind.toLocaleString()} blocks behind`,
						);
				}
				if (issues.length > 0) {
					pageContext = `\n\n## Current resource health\nUser is viewing subgraph "${subgraph.name}":\n${issues.map((i) => `- ${i}`).join("\n")}\nProactively mention these issues if the query is related.`;
				} else {
					pageContext = `\n\n## Current resource\nUser is viewing subgraph "${subgraph.name}", status: ${subgraph.status}`;
				}
			}
		}
	} else if (path === "/" || path === "/platform") {
		// Dashboard — surface triage summary
		const streamTriage = triageStreams(streams);
		const subgraphTriage = triageSubgraphs(subgraphs, chainTip);
		const attention = [...streamTriage.needsAttention, ...subgraphTriage];
		if (attention.length > 0) {
			pageContext = `\n\n## Dashboard health summary\n${attention.map((a) => `- **${a.name}** (${a.status}): ${a.reason}`).join("\n")}\nMention relevant issues if the user asks about health or status.`;
		}
	}

	return `You are the command intelligence for Secondlayer, a blockchain data platform.
The user typed a natural-language query into the command palette (⌘K).

## Tool usage rules
- ALWAYS call lookup_docs before answering questions or building stream/key payloads.
- If the query maps to a known navigation action, use navigate.
- If the query asks to manage existing resources (pause, resume, delete, replay, revoke), use manage_resource. Supports bulk operations — pass multiple targets for "pause all streams", "delete failed streams", etc.
- If the query asks about resource health, errors, or why something is failing/stalled, use diagnose.
- If the query asks to scaffold or generate a subgraph for a contract, use scaffold with the contract ID.
- If the query asks to CREATE resources (streams, API keys), use answer to explain that creation is done via the CLI or API, and provide a code snippet or command they can copy.
- If the query is a question, call lookup_docs, then use answer with grounded markdown.
- ALWAYS end with a terminal tool call (answer, navigate, manage_resource). Never respond with plain text.
- Be concise. No filler.

## App context
Current path: ${path}${pageContext}

## Available actions (for navigate)
${actionList}

## User's resources

### Streams
${streamList}

### Subgraphs
${subgraphList}

### API Keys
${keyList}

## API endpoints
- POST /api/streams — create a stream
- POST /api/streams/{id}/pause — pause a stream
- POST /api/streams/{id}/resume — resume a stream
- POST /api/streams/{id}/disable — disable a stream
- POST /api/streams/{id}/enable — enable a stream
- POST /api/streams/{id}/replay-failed — replay failed deliveries
- DELETE /api/streams/{id} — delete a stream
- POST /api/keys — create an API key
- DELETE /api/keys/{id} — revoke an API key

## Markdown formatting rules (for answer)
- Use \`code ticks\` for product concepts: \`streams\`, \`subgraphs\`, \`API keys\`, \`endpoints\`, \`filters\`, \`deliveries\`.
- Never write two consecutive prose sentences. Break up text with bullet points, numbered lists, tables, or headers.
- Use ## headers to separate topics. Use **bold** for emphasis.
- Prefer structured formats: bullets for features, numbered lists for steps, tables for comparisons.
- Keep paragraphs to one sentence max, then switch to a list or other structure.
- Use > blockquotes for important callouts or tips.`;
}

export async function POST(req: Request) {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: CommandRequest;
	try {
		body = (await req.json()) as CommandRequest;
	} catch {
		return NextResponse.json(
			{ error: "Invalid request body" },
			{ status: 400 },
		);
	}
	const { query, context } = body;

	if (!query || query.length < 3) {
		return NextResponse.json({ error: "Query too short" }, { status: 400 });
	}

	const [streams, subgraphs, keys, statusData] = await Promise.all([
		apiRequest<{ streams: Stream[] }>("/api/streams", { sessionToken })
			.then((r) => r.streams)
			.catch(() => [] as Stream[]),
		apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", { sessionToken })
			.then((r) => r.data)
			.catch(() => [] as SubgraphSummary[]),
		apiRequest<{ keys: ApiKey[] }>("/api/keys", { sessionToken })
			.then((r) => r.keys)
			.catch(() => [] as ApiKey[]),
		apiRequest<{ chainTip?: number }>("/api/status", { sessionToken })
			.then((r) => r.chainTip ?? null)
			.catch(() => null as number | null),
	]);

	const instructions = buildInstructions(
		context.path,
		streams,
		subgraphs,
		keys,
		statusData,
	);
	const agent = createCommandAgent(instructions);

	try {
		const result = await agent.generate({ prompt: query });

		const terminalTools = new Set(["answer", "navigate", "manage_resource"]);

		// Find the terminal tool call (last step, tool without execute fn)
		const lastStep = result.steps[result.steps.length - 1];
		const terminalCall =
			lastStep?.toolCalls.find((tc) => terminalTools.has(tc.toolName)) ??
			lastStep?.toolCalls[lastStep.toolCalls.length - 1];

		if (!terminalCall) {
			// Check for scaffold results in earlier steps via toolResults
			const scaffoldResult = findToolResult(result.steps, "scaffold");
			if (scaffoldResult && !scaffoldResult.error) {
				return NextResponse.json({
					type: "code",
					title: `Scaffold for ${scaffoldResult.contractId}`,
					code: scaffoldResult.code,
					lang: "typescript",
				} satisfies CommandResponse);
			}

			if (result.text) {
				return NextResponse.json({
					type: "info",
					title: "Response",
					markdown: result.text,
				} satisfies CommandResponse);
			}
			return NextResponse.json(
				{ error: "No actionable response" },
				{ status: 422 },
			);
		}

		const response = mapToolCall(
			terminalCall.toolName,
			terminalCall.input as Record<string, unknown>,
		);
		return NextResponse.json(response);
	} catch (err) {
		console.error("[command] Error:", err);
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findToolResult(steps: any[], toolName: string): any | null {
	for (const step of steps) {
		const results = step.toolResults ?? [];
		for (const tr of results) {
			if (tr.toolName === toolName && tr.result) return tr.result;
		}
	}
	return null;
}

function mapToolCall(
	toolName: string,
	input: Record<string, unknown>,
	agentResult?: any,
): CommandResponse {
	switch (toolName) {
		case "navigate":
			return {
				type: "action",
				actionId: input.actionId as string,
				params: input.params as Record<string, unknown> | undefined,
			};

		case "manage_resource": {
			const args = input as {
				action: string;
				resourceType: string;
				targets: Array<{ resourceId: string; resourceName?: string }>;
			};
			const destructiveActions = ["delete", "revoke"];
			const destructive = destructiveActions.includes(args.action);
			const isBulk = args.targets.length > 1;

			const resources = args.targets.map((t) => ({
				name: t.resourceName || t.resourceId,
				meta: args.resourceType,
				status: (destructive ? "red" : "yellow") as "red" | "yellow",
			}));

			const apiCalls = args.targets.map((t) => {
				const { apiPath, method } = resolveManageAction(
					args.action,
					args.resourceType,
					t.resourceId,
				);
				return { method, path: apiPath };
			});

			const title = isBulk
				? `${capitalize(args.action)} ${args.targets.length} ${args.resourceType}s`
				: `${capitalize(args.action)} ${args.resourceType}`;

			return {
				type: "confirm",
				title,
				description: isBulk
					? `${capitalize(args.action)} ${args.targets.length} ${args.resourceType}s`
					: args.targets[0].resourceName
						? `${capitalize(args.action)} "${args.targets[0].resourceName}"`
						: undefined,
				resources,
				destructive,
				apiCalls,
			};
		}

		case "answer": {
			const args = input as {
				title: string;
				markdown: string;
				docUrl?: string;
			};
			return {
				type: "info",
				title: args.title,
				markdown: args.markdown,
				docUrl: args.docUrl,
			};
		}

		default: {
			// Check for scaffold results in the full result
			if (agentResult?.steps) {
				const sr = findToolResult(agentResult.steps, "scaffold");
				if (sr && !sr.error) {
					return {
						type: "code",
						title: `Scaffold for ${sr.contractId}`,
						code: sr.code,
						lang: "typescript",
					};
				}
			}

			// Unknown tool — try to surface as info
			return {
				type: "info",
				title: "Response",
				markdown: JSON.stringify(input, null, 2),
			};
		}
	}
}

function resolveManageAction(
	action: string,
	resourceType: string,
	resourceId: string,
) {
	if (resourceType === "key") {
		return { apiPath: `/api/keys/${resourceId}`, method: "DELETE" };
	}

	const actionMethodMap: Record<
		string,
		{ method: string; pathSuffix: string }
	> = {
		pause: { method: "POST", pathSuffix: "pause" },
		resume: { method: "POST", pathSuffix: "resume" },
		disable: { method: "POST", pathSuffix: "disable" },
		enable: { method: "POST", pathSuffix: "enable" },
		"replay-failed": { method: "POST", pathSuffix: "replay-failed" },
		replay: { method: "POST", pathSuffix: "replay-failed" },
		delete: { method: "DELETE", pathSuffix: "" },
	};

	const mapping = actionMethodMap[action];
	if (!mapping) {
		return { apiPath: `/api/streams/${resourceId}`, method: "POST" };
	}

	const apiPath = mapping.pathSuffix
		? `/api/streams/${resourceId}/${mapping.pathSuffix}`
		: `/api/streams/${resourceId}`;

	return { apiPath, method: mapping.method };
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
