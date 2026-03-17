import { query } from "@anthropic-ai/claude-agent-sdk";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import type { SonnetDiagnosis, PatternMatch, HealthStatus, Decision, Snapshot } from "../types.ts";

const SonnetResponseSchema = z.object({
  severity: z.enum(["info", "warn", "error", "critical"]),
  diagnosis: z.string(),
  suggestedAction: z
    .enum(["restart_service", "vacuum_postgres", "prune_docker", "alert_only", "none"])
    .nullable(),
  steps: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  commands: z.array(z.string()).optional(),
});

const FALLBACK: SonnetDiagnosis = {
  severity: "warn",
  diagnosis: "Sonnet response parse error — manual review needed",
  suggestedAction: null,
  steps: [],
  confidence: 0,
};

// Bash command allowlist patterns
// Note: docker commands only work for app server containers; node server (stacks-node, bitcoind) must be checked via curl
const ALLOWED_BASH_PATTERNS = [
  /^docker\s+(logs|stats|inspect|ps)\b/,
  /^curl\s+-s\s+http:\/\/localhost/,
  /^curl\s+-s\s+http:\/\/37\.27\.171\.220/,
  /^df\b/,
  /^free\b/,
  /^docker\s+exec\s+\S+\s+psql\s+.*-c\s+"SELECT\b/,
];

function isBashAllowed(command: string): boolean {
  return ALLOWED_BASH_PATTERNS.some((p) => p.test(command.trim()));
}

const NODE_SERVER_URL = process.env.NODE_SERVER_URL ?? "http://37.27.171.220";

const SYSTEM_PROMPT = `You are a senior DevOps engineer diagnosing issues in a Stacks blockchain indexing system.

Service topology (two-server):
App server (this machine):
- indexer: Block indexer (port 3700) — safe to restart
- api: REST API (port 3800) — safe to restart
- worker: Job processor — safe to restart
- subgraph-processor: Subgraph computation — safe to restart
- postgres: Main DB (port 5432) — WARN before restart
- caddy: Reverse proxy — safe to restart
- agent: This monitoring agent

Node server (remote, ${NODE_SERVER_URL}):
- bitcoind: Bitcoin Core (port 8332 RPC, 8333 P2P) — monitored via HTTP only
- stacks-node: Stacks blockchain node (port 20443 RPC, 20444 P2P) — monitored via HTTP only
  NOTE: Cannot restart node server services — they run on a separate physical machine.
  docker logs, docker restart, docker stats do NOT work for node server containers.
  To check stacks-node: curl -s ${NODE_SERVER_URL}:20443/v2/info

You have access to Bash:
- docker logs/stats/inspect/ps — app server containers only
- curl -s http://localhost/... — app server endpoints
- curl -s ${NODE_SERVER_URL}:20443/v2/info — check stacks-node status
- df, free — system metrics
- docker exec <container> psql ... -c "SELECT ..." — postgres queries
Investigate the issue, then provide your diagnosis as a JSON object.

Server context:
- Compose dir: /opt/secondlayer/docker
- Compose cmd: docker compose -f docker-compose.yml -f docker-compose.hetzner.yml
- Data dir: /opt/secondlayer/data
- Backup scripts: /opt/secondlayer/docker/scripts/
- Restore: bash /opt/secondlayer/docker/scripts/restore-from-snapshot.sh [--verify-only]
- Container prefix: secondlayer-<service>-1

{
  "severity": "info" | "warn" | "error" | "critical",
  "diagnosis": "detailed explanation",
  "suggestedAction": "restart_service" | "vacuum_postgres" | "prune_docker" | "alert_only" | null,
  "steps": ["step1", "step2"],
  "confidence": 0.0 to 1.0,
  "commands": ["copy-paste shell commands the operator should run"]
}

CRITICAL — evidence-based diagnosis:
- If a tool call fails (command not found, permission denied, timeout), state that explicitly.
- NEVER claim something "was reported" or "was observed" without direct evidence from a successful tool call.
- If ALL diagnostic tools fail: set confidence to 0, diagnosis = "Unable to diagnose — diagnostic tools unavailable."
- If SOME tools fail: base diagnosis ONLY on successful outputs. Note which failed.
- Confidence scale: 0 = no evidence, <0.3 = indirect/partial, 0.3-0.7 = reasonable, >0.7 = strong direct evidence.`;

// Rough Sonnet cost estimate
const SONNET_INPUT_COST_PER_1K = 0.003;
const SONNET_OUTPUT_COST_PER_1K = 0.015;

export async function diagnoseWithSonnet(
  trigger: PatternMatch[],
  context: {
    health?: HealthStatus;
    recentDecisions?: Decision[];
    latestSnapshot?: Snapshot | null;
  },
  apiKey: string
): Promise<{ diagnosis: SonnetDiagnosis; costUsd: number }> {
  const userMessage = `Investigate this issue:

Triggers: ${JSON.stringify(trigger.map((t) => ({ name: t.name, severity: t.severity, service: t.service, message: t.message })))}

Current health: ${JSON.stringify(context.health)}
Recent decisions: ${JSON.stringify(context.recentDecisions?.slice(0, 5))}

Use the available tools to gather more information, then provide your diagnosis as JSON.`;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    const stream = query({
      prompt: userMessage,
      options: {
        model: "claude-sonnet-4-6",
        maxTurns: 5,
        systemPrompt: SYSTEM_PROMPT,
        tools: ["Bash", "Read", "Grep"],
        permissionMode: "default",
        env: {
          ANTHROPIC_API_KEY: apiKey,
        },
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                async (input: HookInput) => {
                  if (input.hook_event_name !== "PreToolUse") return { continue: true };
                  const toolInput = input.tool_input as { command?: string } | undefined;
                  const cmd = toolInput?.command ?? "";
                  if (!isBashAllowed(cmd)) {
                    return {
                      decision: "block" as const,
                      reason: `Command not in allowlist: ${cmd.slice(0, 100)}`,
                    };
                  }
                  return {
                    decision: "approve" as const,
                  };
                },
              ],
            },
          ],
        },
      },
    });

    let lastText = "";

    for await (const message of stream) {
      if (message.type === "assistant" && message.message) {
        const textBlock = message.message.content?.find(
          (b: { type: string }) => b.type === "text"
        );
        if (textBlock && "text" in textBlock) {
          lastText = textBlock.text as string;
        }
      }
      if (message.type === "result" && message.usage) {
        totalInputTokens += message.usage.input_tokens ?? 0;
        totalOutputTokens += message.usage.output_tokens ?? 0;
      }
    }

    const costUsd =
      (totalInputTokens / 1000) * SONNET_INPUT_COST_PER_1K +
      (totalOutputTokens / 1000) * SONNET_OUTPUT_COST_PER_1K;

    // Extract JSON from response
    const jsonMatch = lastText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        diagnosis: { ...FALLBACK, diagnosis: `No JSON in Sonnet response: ${lastText.slice(0, 200)}` },
        costUsd,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result = SonnetResponseSchema.safeParse(parsed);

    if (!result.success) {
      return {
        diagnosis: { ...FALLBACK, diagnosis: `Validation failed: ${result.error.message}` },
        costUsd,
      };
    }

    return { diagnosis: result.data, costUsd };
  } catch (e) {
    return {
      diagnosis: { ...FALLBACK, diagnosis: `Sonnet escalation error: ${e}` },
      costUsd: 0,
    };
  }
}
