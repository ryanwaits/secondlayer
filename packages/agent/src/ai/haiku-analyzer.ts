import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import type { HaikuAnalysis, PatternMatch, HealthStatus, Decision, Snapshot } from "../types.ts";

const ResponseSchema = z.object({
  severity: z.enum(["info", "warn", "error", "critical"]),
  diagnosis: z.string(),
  suggestedAction: z
    .enum(["restart_service", "vacuum_postgres", "prune_docker", "clear_docker_logs", "escalate", "alert_only", "none"])
    .nullable(),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `You are a DevOps monitoring agent for a Stacks blockchain indexing system.

Service topology:
- stacks-node: Blockchain node (port 20443) — NEVER restart, monitor only via RPC
- postgres: Main database — WARN before restart
- hiro-postgres: Hiro API database — WARN before restart
- indexer: Block indexer (port 3700) — safe to restart
- api: REST API (port 3800) — safe to restart
- worker: Job processor — safe to restart
- view-processor: View computation — safe to restart
- hiro-api: Hiro Stacks API (port 3999) — safe to restart
- caddy: Reverse proxy — safe to restart

Safety rules:
- NEVER suggest restarting stacks-node
- For postgres/hiro-postgres, only suggest restart as last resort
- Prefer non-destructive actions (alert_only, prune_docker)

Respond ONLY with valid JSON matching this schema:
{
  "severity": "info" | "warn" | "error" | "critical",
  "diagnosis": "string explaining what's happening",
  "suggestedAction": "restart_service" | "vacuum_postgres" | "prune_docker" | "clear_docker_logs" | "escalate" | "alert_only" | "none" | null,
  "confidence": 0.0 to 1.0
}`;

const FALLBACK: HaikuAnalysis = {
  severity: "warn",
  diagnosis: "AI response parse error — manual review needed",
  suggestedAction: null,
  confidence: 0,
};

// Rough token cost estimate for Haiku
const HAIKU_INPUT_COST_PER_1K = 0.00025;
const HAIKU_OUTPUT_COST_PER_1K = 0.00125;

export async function analyzeWithHaiku(
  trigger: PatternMatch[],
  context: {
    recentLogs?: string[];
    health?: HealthStatus;
    recentDecisions?: Decision[];
    latestSnapshot?: Snapshot | null;
  },
  apiKey: string
): Promise<{ analysis: HaikuAnalysis; costUsd: number }> {
  const client = new Anthropic({ apiKey });

  const userMessage = JSON.stringify(
    {
      trigger: trigger.map((t) => ({ name: t.name, severity: t.severity, service: t.service, message: t.message })),
      health: context.health,
      recentDecisions: context.recentDecisions?.slice(0, 5),
      latestSnapshot: context.latestSnapshot
        ? { disk: context.latestSnapshot.disk, mem: context.latestSnapshot.mem, gaps: context.latestSnapshot.gaps }
        : null,
      recentLogs: context.recentLogs?.slice(-20),
    },
    null,
    2
  );

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    // Estimate cost
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUsd =
      (inputTokens / 1000) * HAIKU_INPUT_COST_PER_1K + (outputTokens / 1000) * HAIKU_OUTPUT_COST_PER_1K;

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { analysis: { ...FALLBACK, diagnosis: `No JSON in response: ${text.slice(0, 200)}` }, costUsd };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result = ResponseSchema.safeParse(parsed);

    if (!result.success) {
      return { analysis: { ...FALLBACK, diagnosis: `Validation failed: ${result.error.message}` }, costUsd };
    }

    return { analysis: result.data, costUsd };
  } catch (e) {
    return { analysis: { ...FALLBACK, diagnosis: `API error: ${e}` }, costUsd: 0 };
  }
}
