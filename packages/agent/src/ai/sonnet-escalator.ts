import { query } from "@anthropic-ai/claude-agent-sdk";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import type { SonnetDiagnosis, PatternMatch, HealthStatus, Decision, Snapshot } from "../types.ts";

// Bash command allowlist patterns
const ALLOWED_BASH_PATTERNS = [
  /^docker\s+(logs|stats|inspect|ps)\b/,
  /^curl\s+-s\s+http:\/\/localhost/,
  /^df\b/,
  /^free\b/,
  /^docker\s+exec\s+\S+\s+psql\s+.*-c\s+"SELECT\b/,
];

function isBashAllowed(command: string): boolean {
  return ALLOWED_BASH_PATTERNS.some((p) => p.test(command.trim()));
}

const SYSTEM_PROMPT = `You are a senior DevOps engineer diagnosing issues in a Stacks blockchain indexing system.

Service topology:
- stacks-node: Blockchain node (port 20443) — NEVER restart
- postgres: Main DB (port 5432) — WARN before restart
- hiro-postgres: Hiro API DB (port 5433) — WARN before restart
- indexer: Block indexer (port 3700) — safe to restart
- api: REST API (port 3800) — safe to restart
- worker: Job processor — safe to restart
- view-processor: View computation — safe to restart
- caddy: Reverse proxy — safe to restart

You have access to Bash (docker logs/stats/inspect, curl localhost, df, free, psql SELECT queries).
Investigate the issue, then provide your diagnosis as a JSON object.

Server context:
- Compose dir: /opt/secondlayer/docker
- Compose cmd: docker compose -f docker-compose.yml -f docker-compose.hetzner.yml
- Data dir: /opt/secondlayer/data
- Backup scripts: /opt/secondlayer/docker/scripts/
- Restore: bash /opt/secondlayer/docker/scripts/restore-from-snapshot.sh [--hiro] [--verify-only]
- Container prefix: secondlayer-<service>-1

{
  "severity": "info" | "warn" | "error" | "critical",
  "diagnosis": "detailed explanation",
  "suggestedAction": "restart_service" | "vacuum_postgres" | "prune_docker" | "alert_only" | null,
  "steps": ["step1", "step2"],
  "confidence": 0.0 to 1.0,
  "commands": ["copy-paste shell commands the operator should run"]
}`;

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
        diagnosis: {
          severity: "warn",
          diagnosis: `No JSON in Sonnet response: ${lastText.slice(0, 200)}`,
          suggestedAction: null,
          steps: [],
          confidence: 0,
        },
        costUsd,
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      diagnosis: {
        severity: parsed.severity ?? "warn",
        diagnosis: parsed.diagnosis ?? "Unknown",
        suggestedAction: parsed.suggestedAction ?? null,
        steps: parsed.steps ?? [],
        confidence: parsed.confidence ?? 0,
        commands: parsed.commands ?? [],
      },
      costUsd,
    };
  } catch (e) {
    return {
      diagnosis: {
        severity: "warn",
        diagnosis: `Sonnet escalation error: ${e}`,
        suggestedAction: null,
        steps: [],
        confidence: 0,
      },
      costUsd: 0,
    };
  }
}
