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
		"One email per outage. If it recovers and fails again, we'll email again.";

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
			preheader: `Failing since ${formatUtc(one.failingSince)}. Events are safe, we keep retrying.`,
			paragraphs: [
				`Every delivery to ${one.host} has failed since ${formatUtc(one.failingSince)}. Your events are safe: we retry for up to 3 days before anything moves to dead letters.`,
				"Once your server answers, queued deliveries go out on their own.",
			],
			facts,
			figure: `webhook · ${one.name}`,
			status: { tone: "alarm", text: "Failing" },
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
	const { html, text } = renderEmail({
		heading: title,
		preheader: `${incidents.map((i) => i.name).join(", ")}. Events are safe.`,
		paragraphs: [
			"Every delivery to these receivers is failing. Your events are safe: we retry for up to 3 days before anything moves to dead letters.",
			"Once your servers answer, queued deliveries go out on their own.",
		],
		facts: incidents.map((i) => ({
			label: i.name,
			value: `${i.host} · since ${formatUtc(i.failingSince)}`,
		})),
		figure: "webhooks",
		status: { tone: "alarm", text: `${incidents.length} failing` },
		cta: { label: "Open your webhooks", url: WEBHOOKS_URL },
		footnote,
	});
	return { subject: title, html, text };
}
