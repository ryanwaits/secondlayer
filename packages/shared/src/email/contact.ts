import { logger } from "../logger.ts";
import { renderEmail } from "./render.ts";
import { sendEmail } from "./send.ts";

export type ContactVolume =
	| "lt10m"
	| "10m-100m"
	| "100m-1b"
	| "gt1b"
	| "unsure";

const VOLUME_LABELS: Record<ContactVolume, string> = {
	lt10m: "under 10M rows/mo",
	"10m-100m": "10M–100M rows/mo",
	"100m-1b": "100M–1B rows/mo",
	gt1b: "over 1B rows/mo",
	unsure: "volume not sure",
};

export interface ContactMessage {
	name: string;
	email: string;
	company: string | null;
	volume: ContactVolume | null;
	message: string;
	source_page: string | null;
}

/**
 * Emails the operator (`CONTACT_NOTIFY_EMAIL`) about a stored contact
 * request and reports whether the message went out. Used by the route that
 * stores the row and by the worker that retries rows still unnotified.
 */
export async function notifyContact(
	id: string,
	row: ContactMessage,
): Promise<boolean> {
	const to = process.env.CONTACT_NOTIFY_EMAIL?.trim();
	if (!to) {
		logger.info("contact.notify_skipped", { id, reason: "no notify address" });
		return false;
	}
	const volumeLabel = row.volume
		? VOLUME_LABELS[row.volume]
		: "volume not given";
	const reference = `ctc_${id.slice(0, 6)}`;
	const { html, text } = renderEmail({
		heading: "New contact request",
		preheader: row.message.slice(0, 90),
		paragraphs: [],
		quote: row.message,
		figure: `contact · ${reference}`,
		facts: [
			{ label: "Name", value: row.name },
			{ label: "Email", value: row.email },
			{ label: "Company", value: row.company ?? "not given" },
			{ label: "Volume", value: volumeLabel },
			{ label: "From page", value: row.source_page ?? "not given" },
			{ label: "Reference", value: reference },
		],
		footnote: `Reply to this email to answer ${row.name.split(/\s+/)[0]}.`,
	});
	try {
		const result = await sendEmail({
			to,
			replyTo: row.email,
			subject: `Contact: ${row.company ?? row.name} · ${volumeLabel}`,
			html,
			text,
		});
		if (result.skipped) {
			logger.info("contact.notify_skipped", { id, reason: "no email key" });
			return false;
		}
		return true;
	} catch (err) {
		logger.error("contact.notify_failed", {
			id,
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
}
