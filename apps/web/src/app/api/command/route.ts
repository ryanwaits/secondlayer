import { NextResponse } from "next/server";
import { getSessionFromRequest, apiRequest } from "@/lib/api";
import { actions } from "@/lib/actions/registry";
import { createCommandAgent } from "@/lib/command/agent";
import type { CommandRequest, CommandResponse } from "@/lib/command/types";
import type { Stream, SubgraphSummary, ApiKey } from "@/lib/types";

function buildInstructions(
  path: string,
  streams: Stream[],
  subgraphs: SubgraphSummary[],
  keys: ApiKey[],
) {
  const actionList = actions
    .map((a) => `- ${a.id}: "${a.label}" [${a.category}] keywords: ${a.keywords.join(", ")}`)
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
    ? keys.map((k) => `- id:${k.id} prefix:${k.prefix} name:"${k.name}" status:${k.status}`).join("\n")
    : "No API keys.";

  return `You are the command intelligence for Secondlayer, a blockchain data platform.
The user typed a natural-language query into the command palette (⌘K).

## Tool usage rules
- ALWAYS call lookup_docs before answering questions or building stream/key payloads.
- If the query maps to a known navigation action, use navigate.
- If the query asks to manage existing resources (pause, resume, delete, replay, revoke), use manage_resource. Supports bulk operations — pass multiple targets for "pause all streams", "delete failed streams", etc.
- If the query asks to CREATE resources (streams, API keys), use answer to explain that creation is done via the CLI or API, and provide a code snippet or command they can copy.
- If the query is a question, call lookup_docs, then use answer with grounded markdown.
- ALWAYS end with a terminal tool call (answer, navigate, create_stream, create_api_key, manage_resource). Never respond with plain text.
- Be concise. No filler.

## App context
Current path: ${path}

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
- Use \`code ticks\` for product concepts: \`streams\`, \`subgraphs\`, \`API keys\`, \`webhooks\`, \`filters\`, \`deliveries\`.
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
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { query, context } = body;

  if (!query || query.length < 3) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  const [streams, subgraphs, keys] = await Promise.all([
    apiRequest<{ streams: Stream[] }>("/api/streams", { sessionToken })
      .then((r) => r.streams)
      .catch(() => [] as Stream[]),
    apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", { sessionToken })
      .then((r) => r.data)
      .catch(() => [] as SubgraphSummary[]),
    apiRequest<{ keys: ApiKey[] }>("/api/keys", { sessionToken })
      .then((r) => r.keys)
      .catch(() => [] as ApiKey[]),
  ]);

  const instructions = buildInstructions(context.path, streams, subgraphs, keys);
  const agent = createCommandAgent(instructions);

  try {
    const result = await agent.generate({ prompt: query });

    const terminalTools = new Set(["answer", "navigate", "manage_resource"]);

    // Find the terminal tool call (last step, tool without execute fn)
    const lastStep = result.steps[result.steps.length - 1];
    const terminalCall = lastStep?.toolCalls.find(
      (tc) => terminalTools.has(tc.toolName),
    ) ?? lastStep?.toolCalls[lastStep.toolCalls.length - 1];

    if (!terminalCall) {
      if (result.text) {
        return NextResponse.json({
          type: "info",
          title: "Response",
          markdown: result.text,
        } satisfies CommandResponse);
      }
      return NextResponse.json({ error: "No actionable response" }, { status: 422 });
    }

    const response = mapToolCall(terminalCall.toolName, terminalCall.input as Record<string, unknown>);
    return NextResponse.json(response);
  } catch (err) {
    console.error("[command] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function mapToolCall(
  toolName: string,
  input: Record<string, unknown>,
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
        const { apiPath, method } = resolveManageAction(args.action, args.resourceType, t.resourceId);
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
      const args = input as { title: string; markdown: string; docUrl?: string };
      return {
        type: "info",
        title: args.title,
        markdown: args.markdown,
        docUrl: args.docUrl,
      };
    }

    default:
      // Unknown tool — try to surface as info if there's text
      return {
        type: "info",
        title: "Response",
        markdown: JSON.stringify(input, null, 2),
      };
  }
}

function resolveManageAction(action: string, resourceType: string, resourceId: string) {
  if (resourceType === "key") {
    return { apiPath: `/api/keys/${resourceId}`, method: "DELETE" };
  }

  const actionMethodMap: Record<string, { method: string; pathSuffix: string }> = {
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
