import { NextResponse } from "next/server";
import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { getSessionFromRequest, apiRequest } from "@/lib/api";
import { actions } from "@/lib/actions/registry";
import type { CommandRequest, CommandResponse } from "@/lib/command/types";
import type { Stream, ViewSummary, ApiKey } from "@/lib/types";

function buildSystemPrompt(
  path: string,
  streams: Stream[],
  views: ViewSummary[],
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

  const viewList = views.length
    ? views.map((v) => `- name:"${v.name}" status:${v.status}`).join("\n")
    : "No views.";

  const keyList = keys.length
    ? keys.map((k) => `- id:${k.id} prefix:${k.prefix} name:"${k.name}" status:${k.status}`).join("\n")
    : "No API keys.";

  return `You are the command intelligence for Secondlayer, a blockchain data platform.
The user typed a natural-language query into the command palette (⌘K).
Your job: map it to exactly ONE tool call.

## App context
Current path: ${path}

## Available actions (for map_action)
${actionList}

## User's resources

### Streams
${streamList}

### Views
${viewList}

### API Keys
${keyList}

## API endpoints (for confirm_action)
- POST /api/streams/{id}/pause — pause a stream
- POST /api/streams/{id}/resume — resume a stream
- POST /api/streams/{id}/disable — disable a stream
- POST /api/streams/{id}/enable — enable a stream
- POST /api/streams/{id}/replay-failed — replay failed deliveries
- DELETE /api/streams/{id} — delete a stream
- DELETE /api/keys/{id} — revoke an API key

## Rules
- If the query maps to a known action, use map_action.
- If the query requires modifying resources (pause, delete, resume, etc.), use confirm_action. Include ALL affected resources as display-only items. Include all API calls in the top-level apiCalls array.
- If the query asks to generate code (scaffold, create, write), use generate_code.
- If the query is a question, use answer_question.
- Be concise. No filler.

## Markdown formatting rules (for answer_question)
- Use \`code ticks\` for product concepts: \`streams\`, \`views\`, \`API keys\`, \`webhooks\`, \`filters\`, \`deliveries\`.
- Never write two consecutive prose sentences. Break up text with bullet points, numbered lists, tables, or headers.
- Use ## headers to separate topics. Use **bold** for emphasis.
- Prefer structured formats: bullets for features, numbered lists for steps, tables for comparisons.
- Keep paragraphs to one sentence max, then switch to a list or other structure.
- Use > blockquotes for important callouts or tips.`;
}

const commandTools = {
  map_action: tool({
    description: "Map the query to a known action in the command palette registry.",
    inputSchema: z.object({
      actionId: z.string().describe("The action ID from the registry"),
      params: z.record(z.string(), z.unknown()).optional().describe("Optional parameters"),
    }),
  }),
  confirm_action: tool({
    description:
      "Present a confirmation UI for destructive or multi-resource operations. Resources are display-only; all execution happens via the top-level apiCalls array.",
    inputSchema: z.object({
      title: z.string().describe("Short action summary, used as the confirm button label"),
      description: z.string().optional().describe("Optional detail"),
      resources: z.array(
        z.object({
          name: z.string(),
          meta: z.string().optional(),
          status: z.enum(["green", "red", "yellow"]).optional(),
        }),
      ),
      destructive: z.boolean(),
      apiCalls: z.array(
        z.object({
          method: z.string(),
          path: z.string(),
          body: z.record(z.string(), z.unknown()).optional(),
        }),
      ).describe("All API calls for the bulk action"),
    }),
  }),
  generate_code: tool({
    description: "Generate code for the user (views, queries, etc.).",
    inputSchema: z.object({
      title: z.string(),
      code: z.string(),
      lang: z.string().describe("Language (typescript, sql, etc.)"),
    }),
  }),
  answer_question: tool({
    description: "Answer an informational question about Secondlayer. Return the answer as markdown with headers, lists, code blocks, etc.",
    inputSchema: z.object({
      title: z.string(),
      markdown: z.string().describe("Answer in markdown format"),
      docUrl: z.string().optional(),
    }),
  }),
};

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

  // Fetch user resources for context
  const [streams, views, keys] = await Promise.all([
    apiRequest<{ streams: Stream[] }>("/api/streams", { sessionToken })
      .then((r) => r.streams)
      .catch(() => [] as Stream[]),
    apiRequest<{ data: ViewSummary[] }>("/api/views", { sessionToken })
      .then((r) => r.data)
      .catch(() => [] as ViewSummary[]),
    apiRequest<{ keys: ApiKey[] }>("/api/keys", { sessionToken })
      .then((r) => r.keys)
      .catch(() => [] as ApiKey[]),
  ]);

  const systemPrompt = buildSystemPrompt(context.path, streams, views, keys);

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      maxOutputTokens: 2048,
      system: systemPrompt,
      tools: commandTools,
      toolChoice: "required",
      prompt: query,
    });

    const toolCall = result.toolCalls[0];
    if (!toolCall) {
      return NextResponse.json({ error: "No actionable response" }, { status: 422 });
    }

    const response = mapToolCall(toolCall.toolName, toolCall.input as Record<string, unknown>);
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
    case "map_action":
      return {
        type: "action",
        actionId: input.actionId as string,
        params: input.params as Record<string, unknown> | undefined,
      };

    case "confirm_action": {
      const args = input as {
        title: string;
        description?: string;
        resources: { name: string; meta?: string; status?: "green" | "red" | "yellow" }[];
        destructive: boolean;
        apiCalls: { method: string; path: string; body?: Record<string, unknown> }[];
      };
      return {
        type: "confirm",
        title: args.title,
        description: args.description,
        resources: args.resources,
        destructive: args.destructive,
        apiCalls: args.apiCalls,
      };
    }

    case "generate_code": {
      const args = input as { title: string; code: string; lang: string };
      return {
        type: "code",
        title: args.title,
        code: args.code,
        lang: args.lang,
      };
    }

    case "answer_question": {
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

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
