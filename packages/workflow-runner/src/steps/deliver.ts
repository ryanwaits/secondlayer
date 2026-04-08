import type { DeliverTarget } from "@secondlayer/workflows";
import { logger } from "@secondlayer/shared/logger";

/** Dispatch a delivery to webhook, Slack, or email. */
export async function executeDeliverStep(
	target: DeliverTarget,
): Promise<void> {
	switch (target.type) {
		case "webhook":
			await deliverWebhook(target.url, target.body, target.headers);
			break;
		case "slack":
			await deliverSlack(target.channel, target.text);
			break;
		case "email":
			await deliverEmail(target.to, target.subject, target.body);
			break;
		default:
			throw new Error(`Unknown delivery target type: ${(target as Record<string, unknown>).type}`);
	}
}

async function deliverWebhook(
	url: string,
	body: Record<string, unknown>,
	headers?: Record<string, string>,
): Promise<void> {
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...headers,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(
			`Webhook delivery failed: ${response.status} ${response.statusText}`,
		);
	}

	logger.debug(`Webhook delivered to ${url} (${response.status})`);
}

async function deliverSlack(
	channel: string,
	text: string,
): Promise<void> {
	// Channel is expected to be a Slack webhook URL
	const response = await fetch(channel, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text }),
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		throw new Error(
			`Slack delivery failed: ${response.status} ${response.statusText}`,
		);
	}

	logger.debug("Slack message delivered");
}

async function deliverEmail(
	to: string,
	subject: string,
	body: string,
): Promise<void> {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		throw new Error("RESEND_API_KEY not configured for email delivery");
	}

	const fromAddress =
		process.env.RESEND_FROM ?? "workflows@secondlayer.tools";

	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: fromAddress,
			to: [to],
			subject,
			html: body,
		}),
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		const err = await response.text();
		throw new Error(`Email delivery failed: ${response.status} ${err}`);
	}

	logger.debug(`Email delivered to ${to}`);
}
