import type { Decision, Severity, Snapshot } from "../types.ts";

export interface SlackAlertPayload {
	severity: Severity;
	title: string;
	service: string;
	details: string;
	action?: string;
	outcome?: string;
	commands?: string[];
}

export const SEVERITY_EMOJI: Record<Severity, string> = {
	info: ":information_source:",
	warn: ":warning:",
	error: ":x:",
	critical: ":rotating_light:",
};

function log(msg: string): void {
	console.log(`[${new Date().toISOString()}] [slack] ${msg}`);
}

export class SlackClient {
	private webhookUrl: string;
	private apiToken: string;
	private channelId: string;

	constructor(opts: {
		webhookUrl: string;
		apiToken?: string;
		channelId?: string;
	}) {
		this.webhookUrl = opts.webhookUrl;
		this.apiToken = opts.apiToken ?? "";
		this.channelId = opts.channelId ?? "";
	}

	get canThread(): boolean {
		return !!(this.apiToken && this.channelId);
	}

	/** Post an alert. Returns message ts (API mode) or null (webhook mode). */
	async postAlert(blocks: object[], threadTs?: string): Promise<string | null> {
		if (this.canThread) {
			return this.apiPost("chat.postMessage", {
				channel: this.channelId,
				blocks,
				...(threadTs ? { thread_ts: threadTs } : {}),
			});
		}
		await this.postToWebhook({ blocks });
		return null;
	}

	/** Post a thread reply. Returns message ts or null. */
	async postThreadReply(
		threadTs: string,
		text: string,
	): Promise<string | null> {
		if (!this.canThread) return null;
		return this.apiPost("chat.postMessage", {
			channel: this.channelId,
			thread_ts: threadTs,
			text,
		});
	}

	/** Update an existing message. Returns true on success. */
	async updateMessage(ts: string, blocks: object[]): Promise<boolean> {
		if (!this.canThread) return false;
		const result = await this.apiPost("chat.update", {
			channel: this.channelId,
			ts,
			blocks,
		});
		return result !== null;
	}

	/** Send an alert using the legacy payload format (convenience wrapper). */
	async sendAlert(
		payload: SlackAlertPayload,
		threadTs?: string,
	): Promise<string | null> {
		const blocks = buildAlertBlocks(payload);
		return this.postAlert(blocks, threadTs);
	}

	/** Send daily summary. Always top-level. */
	async sendDailySummary(
		snapshot: Snapshot | null,
		decisions: Decision[],
	): Promise<boolean> {
		if (!this.webhookUrl && !this.canThread) return false;

		const actionsToday = decisions.length;
		const aiSpend = decisions.reduce((sum, d) => sum + d.costUsd, 0);

		let servicesText = "No snapshot available";
		if (snapshot) {
			try {
				const services = JSON.parse(snapshot.services);
				const healthy = Object.values(services).filter(
					(v) => v === "healthy",
				).length;
				const total = Object.keys(services).length;
				servicesText = `${healthy}/${total} healthy`;
			} catch {
				servicesText = "Parse error";
			}
		}

		const blocks = [
			{
				type: "header",
				text: {
					type: "plain_text",
					text: ":chart_with_upwards_trend: Daily Summary",
				},
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

		if (this.canThread) {
			const ts = await this.apiPost("chat.postMessage", {
				channel: this.channelId,
				blocks,
			});
			return ts !== null;
		}
		return this.postToWebhook({ blocks });
	}

	/** Raw Slack Web API call. Returns message ts on success, null on failure. */
	private async apiPost(method: string, body: object): Promise<string | null> {
		try {
			const res = await fetch(`https://slack.com/api/${method}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiToken}`,
				},
				body: JSON.stringify(body),
			});

			if (!res.ok) {
				log(`Slack API HTTP error: ${res.status}`);
				return null;
			}

			const data = (await res.json()) as {
				ok: boolean;
				ts?: string;
				error?: string;
			};
			if (!data.ok) {
				log(`Slack API error: ${data.error}`);
				return null;
			}

			return data.ts ?? null;
		} catch (e) {
			log(`Slack API fetch error: ${e}`);
			return null;
		}
	}

	/** Post to webhook with retry. Returns true on success. */
	private async postToWebhook(body: object): Promise<boolean> {
		if (!this.webhookUrl) return false;

		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const res = await fetch(this.webhookUrl, {
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
}

/** Build standard alert blocks from payload. */
export function buildAlertBlocks(payload: SlackAlertPayload): object[] {
	const blocks: object[] = [
		{
			type: "header",
			text: {
				type: "plain_text",
				text: `${SEVERITY_EMOJI[payload.severity]} ${payload.title}`,
			},
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
				...(payload.action
					? [{ type: "mrkdwn", text: `*Action:*\n${payload.action}` }]
					: []),
				...(payload.outcome
					? [{ type: "mrkdwn", text: `*Outcome:*\n${payload.outcome}` }]
					: []),
			],
		});
	}

	if (payload.commands?.length) {
		blocks.push(
			{ type: "divider" },
			{
				type: "section",
				text: {
					type: "mrkdwn",
					text: `*Runbook:*\n\`\`\`\n${payload.commands.join("\n")}\n\`\`\``,
				},
			},
		);
	}

	return blocks;
}

// Compat shims for existing call sites (removed in 1.4)
export async function sendSlackAlert(
	webhookUrl: string,
	payload: SlackAlertPayload,
): Promise<boolean> {
	const client = new SlackClient({ webhookUrl });
	const ts = await client.sendAlert(payload);
	return ts !== null || webhookUrl !== "";
}

export async function sendDailySummary(
	webhookUrl: string,
	snapshot: Snapshot | null,
	decisions: Decision[],
): Promise<boolean> {
	const client = new SlackClient({ webhookUrl });
	return client.sendDailySummary(snapshot, decisions);
}
