import type { Severity, Decision, Snapshot } from "../types.ts";

interface SlackAlertPayload {
  severity: Severity;
  title: string;
  service: string;
  details: string;
  action?: string;
  outcome?: string;
  commands?: string[];
}

const SEVERITY_EMOJI: Record<Severity, string> = {
  info: ":information_source:",
  warn: ":warning:",
  error: ":x:",
  critical: ":rotating_light:",
};

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [slack] ${msg}`);
}

export async function sendSlackAlert(webhookUrl: string, payload: SlackAlertPayload): Promise<boolean> {
  if (!webhookUrl) return false;

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

  return postToSlack(webhookUrl, { blocks });
}

export async function sendDailySummary(
  webhookUrl: string,
  snapshot: Snapshot | null,
  decisions: Decision[]
): Promise<boolean> {
  if (!webhookUrl) return false;

  const actionsToday = decisions.length;
  const aiSpend = decisions.reduce((sum, d) => sum + d.costUsd, 0);

  let servicesText = "No snapshot available";
  if (snapshot) {
    try {
      const services = JSON.parse(snapshot.services);
      const healthy = Object.values(services).filter((v) => v === "healthy").length;
      const total = Object.keys(services).length;
      servicesText = `${healthy}/${total} healthy`;
    } catch {
      servicesText = "Parse error";
    }
  }

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: ":chart_with_upwards_trend: Daily Summary" },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Services:*\n${servicesText}` },
        { type: "mrkdwn", text: `*Actions Today:*\n${actionsToday}` },
        { type: "mrkdwn", text: `*AI Spend:*\n$${aiSpend.toFixed(4)}` },
        { type: "mrkdwn", text: `*Gaps:*\n${snapshot?.gaps ?? "unknown"}` },
      ],
    },
  ];

  return postToSlack(webhookUrl, { blocks });
}

async function postToSlack(webhookUrl: string, body: object): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) return true;

      if (res.status >= 500 && attempt === 0) {
        log(`Slack 5xx (${res.status}), retrying...`);
        continue;
      }

      log(`Slack error: ${res.status} ${await res.text()}`);
      return false;
    } catch (e) {
      log(`Slack fetch error: ${e}`);
      if (attempt === 0) continue;
      return false;
    }
  }
  return false;
}
