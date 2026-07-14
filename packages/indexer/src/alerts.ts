import { logger } from "@secondlayer/shared/logger";

/** Posts to SLACK_WEBHOOK_URL if set; no-ops otherwise (e.g. local/dev). */
export async function sendSlackAlert(message: string): Promise<void> {
	const webhookUrl = process.env.SLACK_WEBHOOK_URL;
	if (!webhookUrl) return;

	try {
		await fetch(webhookUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: message }),
		});
	} catch (err) {
		logger.warn("Slack alert failed", { error: err });
	}
}
