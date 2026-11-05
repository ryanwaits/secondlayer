import { renderEmail } from "./render.ts";

/**
 * The email updates list: sender, links and the double opt-in email. Every
 * list email must carry `unsubscribeFor(token)` (footer link plus the
 * RFC 8058 headers Gmail and Yahoo require from bulk senders).
 */

export const UPDATES_FROM = "Secondlayer <dev@secondlayer.tools>";
export const UPDATES_SITE_URL = "https://www.secondlayer.tools";
export const UPDATES_API_URL = "https://api.secondlayer.tools";

/** Footer link (a web page that unsubscribes on load) and one-click headers. */
export function unsubscribeFor(token: string): {
	url: string;
	headers: Record<string, string>;
} {
	const t = encodeURIComponent(token);
	return {
		url: `${UPDATES_SITE_URL}/updates/unsubscribe?t=${t}`,
		headers: {
			"List-Unsubscribe": `<${UPDATES_API_URL}/api/public/updates/unsubscribe?t=${t}>`,
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	};
}

/**
 * The double opt-in email. No unsubscribe link or headers: the address is
 * not on the list until it confirms.
 */
export function confirmEmail(token: string): {
	subject: string;
	html: string;
	text: string;
} {
	const subject = "Confirm your secondlayer subscription";
	const { html, text } = renderEmail({
		heading: "Confirm your email",
		preheader: "One click and new posts and launches come to this inbox.",
		paragraphs: [
			"Confirm and we'll email you when we publish a post or ship something new. Nothing else, and every email has a one-click unsubscribe.",
		],
		cta: {
			label: "Confirm subscription",
			url: `${UPDATES_SITE_URL}/updates/confirm?t=${encodeURIComponent(token)}`,
		},
		footnote:
			"Someone entered this address at secondlayer.tools/blog. If it wasn't you, ignore this email and you won't hear from us. The link works for 7 days.",
	});
	return { subject, html, text };
}
