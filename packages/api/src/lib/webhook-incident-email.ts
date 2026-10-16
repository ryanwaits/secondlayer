import { renderEmail } from "@secondlayer/shared/email";

/**
 * Copy for the "webhook can't reach your server" email. One email per account
 * per tick: a single webhook gets the detailed layout, several get a list.
 * Sent from `POST /internal/webhook-incidents`.
 */

export interface IncidentEmailItem {
	id: string;
	name: string;
	host: string;
	failingSince: Date;
	failures: number;
	lastError: string | null;
}

const WEBHOOKS_URL = "https://secondlayer.tools/account/webhooks";

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** "Oct 15, 09:05 UTC" */
function formatUtc(date: Date): string {
	const hh = String(date.getUTCHours()).padStart(2, "0");
	const mm = String(date.getUTCMinutes()).padStart(2, "0");
	return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${hh}:${mm} UTC`;
}

export function buildWebhookIncidentEmail(incidents: IncidentEmailItem[]): {
	subject: string;
	html: string;
	text: string;
} {
	const footnote =
		"We send one email per outage. If it recovers and fails again, you'll hear from us again.";

	if (incidents.length === 1) {
		const [one] = incidents as [IncidentEmailItem];
		const title = `"${one.name}" can't reach your server`;
		const facts = [
			{ label: "Webhook", value: one.name },
			{ label: "Receiver", value: one.host },
			{ label: "Failing since", value: formatUtc(one.failingSince) },
			{ label: "Failed attempts in a row", value: String(one.failures) },
		];
		if (one.lastError)
			facts.push({ label: "Last error", value: one.lastError });
		const { html, text } = renderEmail({
			heading: title,
			paragraphs: [
				`Since ${formatUtc(one.failingSince)}, every delivery to ${one.host} has failed. Your events are safe: we keep retrying for up to 3 days before anything moves to dead letters.`,
				"Once your server answers again, queued deliveries go out on their own.",
			],
			facts,
			cta: {
				label: "Open the webhook",
				url: `${WEBHOOKS_URL}/${one.id}`,
			},
			footnote,
		});
		return {
			subject: `Your webhook "${one.name}" can't reach your server`,
			html,
			text,
		};
	}

	const title = `${incidents.length} of your webhooks can't reach your server`;
	const list = incidents.map((i) => `"${i.name}" (${i.host})`).join(", ");
	const { html, text } = renderEmail({
		heading: title,
		paragraphs: [
			`Every delivery to these receivers is failing: ${list}. Your events are safe: we keep retrying for up to 3 days before anything moves to dead letters.`,
			"Once your servers answer again, queued deliveries go out on their own.",
		],
		facts: incidents.map((i) => ({
			label: i.name,
			value: `failing since ${formatUtc(i.failingSince)}`,
		})),
		cta: { label: "Open your webhooks", url: WEBHOOKS_URL },
		footnote,
	});
	return { subject: title, html, text };
}
