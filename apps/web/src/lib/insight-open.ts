/**
 * Which insights the reader left open or closed, on every page under
 * /account. Kept in a small first-party cookie so the server render already
 * knows it. Only insight ids and a boolean each are stored, newest kept.
 */

export const OPEN_COOKIE = "sl_insight_open";
const MAX_ENTRIES = 40;
const MAX_AGE_S = 90 * 24 * 60 * 60;

export type OpenChoices = Readonly<Record<string, boolean>>;

/** `id:1~id:0`, oldest first, URL-encoded. */
export function serializeOpenChoices(choices: OpenChoices): string {
	const kept = Object.entries(choices).slice(-MAX_ENTRIES);
	return encodeURIComponent(
		kept.map(([id, open]) => `${id}:${open ? 1 : 0}`).join("~"),
	);
}

/** The saved choices; anything malformed is dropped, so the default applies. */
export function parseOpenChoices(raw: string | null | undefined): OpenChoices {
	if (!raw) return {};
	let text = raw;
	try {
		text = decodeURIComponent(raw);
	} catch {
		// Already decoded, or not ours: parse it as it is.
	}
	const out: Record<string, boolean> = {};
	for (const part of text.split("~")) {
		const at = part.lastIndexOf(":");
		const flag = part.slice(at + 1);
		if (at < 1 || (flag !== "1" && flag !== "0")) continue;
		out[part.slice(0, at)] = flag === "1";
	}
	return out;
}

/** Writes the cookie from the browser. A blocked cookie means the choice
 *  lasts for this visit only. */
export function writeOpenChoices(choices: OpenChoices): void {
	try {
		const secure = window.location.protocol === "https:" ? "; Secure" : "";
		document.cookie = `${OPEN_COOKIE}=${serializeOpenChoices(choices)}; path=/account; max-age=${MAX_AGE_S}; SameSite=Lax${secure}`;
	} catch {
		// Cookies are blocked.
	}
}

type OpenInput = { id: string; severity: string };

/** A new insight that is losing events or about to fail opens on its own. */
const opensByDefault = (i: OpenInput): boolean =>
	i.severity === "losing" || i.severity === "will_fail";

/**
 * Whether a page's one line is open. Each insight counts by the reader's
 * saved choice, else its default; one that counts open opens the line. So a
 * hidden line stays hidden until a new insight arrives that opens on its own.
 */
export function lineOpen(
	insights: readonly OpenInput[],
	saved: OpenChoices,
): boolean {
	return insights.some((i) => saved[i.id] ?? opensByDefault(i));
}
