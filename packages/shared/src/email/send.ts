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
	/** Where a reply goes; omitted, replies go to the From address. */
	replyTo?: string;
	/** Overrides the `EMAIL_FROM` default. */
	from?: string;
	/** Extra message headers, e.g. RFC 8058 `List-Unsubscribe`. */
	headers?: Record<string, string>;
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
		input.from ??
		process.env.EMAIL_FROM ??
		"secondlayer <noreply@secondlayer.tools>";

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
			...(input.replyTo ? { reply_to: [input.replyTo] } : {}),
			...(input.headers && Object.keys(input.headers).length > 0
				? { headers: input.headers }
				: {}),
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
