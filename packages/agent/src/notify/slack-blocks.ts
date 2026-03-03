import type { Severity } from "../types.ts";
import { SEVERITY_EMOJI, type SlackAlertPayload } from "./slack.ts";

export interface ButtonAction {
  alertId: number;
  service: string;
  action: string;
}

/** Build alert blocks with optional action buttons. */
export function buildAlertBlocksWithButtons(
  payload: SlackAlertPayload,
  opts?: { alertId?: number; service?: string }
): object[] {
  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${SEVERITY_EMOJI[payload.severity]} ${payload.title}` },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Service:*\n${payload.service}` },
        { type: "mrkdwn", text: `*Severity:*\n${payload.severity}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Details:*\n${payload.details}` },
    },
  ];

  if (payload.action || payload.outcome) {
    blocks.push({
      type: "section",
      fields: [
        ...(payload.action ? [{ type: "mrkdwn", text: `*Action:*\n${payload.action}` }] : []),
        ...(payload.outcome ? [{ type: "mrkdwn", text: `*Outcome:*\n${payload.outcome}` }] : []),
      ],
    });
  }

  if (payload.commands?.length) {
    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Runbook:*\n\`\`\`\n${payload.commands.join("\n")}\n\`\`\`` },
      }
    );
  }

  if (opts?.alertId != null) {
    const actionBlock = buildActionButtons(payload.severity, opts.service ?? payload.service, opts.alertId);
    if (actionBlock) blocks.push(actionBlock);
  }

  return blocks;
}

/** Build action buttons based on severity. */
export function buildActionButtons(severity: Severity, service: string, alertId: number): object | null {
  const btn = (text: string, action: string, style?: string) => ({
    type: "button",
    text: { type: "plain_text", text },
    value: JSON.stringify({ alertId, service, action } satisfies ButtonAction),
    action_id: action,
    ...(style ? { style } : {}),
  });

  if (severity === "error" || severity === "critical") {
    return {
      type: "actions",
      elements: [
        btn("Restart", "agent_restart", "danger"),
        btn("Investigate", "agent_investigate"),
        btn("Dismiss", "agent_dismiss"),
      ],
    };
  }

  if (severity === "warn") {
    return {
      type: "actions",
      elements: [
        btn("Verify", "agent_verify"),
        btn("Dismiss", "agent_dismiss"),
      ],
    };
  }

  return null;
}

/** Build diagnosis blocks with execute/dismiss buttons. */
export function buildDiagnosisBlocks(
  analysis: { diagnosis: string; confidence: number; suggestedAction?: string | null; commands?: string[] },
  alertId: number,
  service: string
): object[] {
  const lowConfidence = analysis.confidence < 0.5;
  const diagnosisText = lowConfidence
    ? `:warning: *Unverified — low confidence diagnosis*\n\n${analysis.diagnosis}\n\n*Confidence:* ${(analysis.confidence * 100).toFixed(0)}%`
    : `*AI Diagnosis:*\n${analysis.diagnosis}\n\n*Confidence:* ${(analysis.confidence * 100).toFixed(0)}%`;

  const blocks: object[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: diagnosisText },
    },
  ];

  if (analysis.commands?.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Suggested commands:*\n\`\`\`\n${analysis.commands.join("\n")}\n\`\`\`` },
    });
  }

  const elements: object[] = [];
  const noopActions = ["none", "escalate", "alert_only"];
  if (analysis.suggestedAction && !noopActions.includes(analysis.suggestedAction) && !lowConfidence) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "Execute Suggested" },
      value: JSON.stringify({ alertId, service, action: `agent_execute:${analysis.suggestedAction}` } satisfies ButtonAction),
      action_id: "agent_execute_suggested",
      style: "primary",
    });
  }
  elements.push({
    type: "button",
    text: { type: "plain_text", text: "Dismiss" },
    value: JSON.stringify({ alertId, service, action: "agent_dismiss" } satisfies ButtonAction),
    action_id: "agent_dismiss",
  });

  blocks.push({ type: "actions", elements });

  return blocks;
}

/** Remove action blocks from a message (for resolved messages). */
export function stripButtons(blocks: object[]): object[] {
  return blocks.filter((b) => (b as { type: string }).type !== "actions");
}

/** Add a resolved footer to blocks. */
export function addResolvedFooter(blocks: object[], text: string): object[] {
  return [
    ...stripButtons(blocks),
    { type: "divider" },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `:white_check_mark: ${text}` }],
    },
  ];
}
