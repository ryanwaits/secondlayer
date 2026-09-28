import { logger } from "../logger.ts";

/**
 * The one Resend call every customer email goes through. Never throws when
 * `RESEND_API_KEY` is unset — that's a dev/CI/self-host state, not a send
 * failure — it logs a warning and reports `{ skipped: true }` so a caller
 * can still record its own "notification sent" bookkeeping accurately.
 */

export interface SendEmailInput {
	to: string;
	subject: string;
	html: string;
	text: string;
}

export type SendEmailResult = { skipped: true } | { skipped: false };

export async function sendEmail(
	input: SendEmailInput,
): Promise<SendEmailResult> {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) {
		logger.warn("RESEND_API_KEY unset — skipping email", {
			subject: input.subject,
		});
		return { skipped: true };
	}

	const from =
		process.env.EMAIL_FROM ?? "secondlayer <noreply@secondlayer.tools>";

	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			from,
			to: [input.to],
			subject: input.subject,
			html: input.html,
			text: input.text,
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`Resend API error (${response.status}): ${body.slice(0, 200)}`,
		);
	}

	return { skipped: false };
}
