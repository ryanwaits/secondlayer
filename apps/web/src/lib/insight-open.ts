/**
 * Which findings the reader left open or closed. Kept in a small first-party
 * cookie so the server render already knows it. Only insight ids and a
 * boolean each are stored.
 */

export const OPEN_COOKIE = "sl_insight_open";
const MAX_ENTRIES = 20;
const MAX_AGE_S = 90 * 24 * 60 * 60;

export type OpenChoices = Readonly<Record<string, boolean>>;

/** `id:1~id:0`, oldest first, URL-encoded. */
export function serializeOpenChoices(
	choices: OpenChoices,
	presentIds: readonly string[],
): string {
	const kept = Object.entries(choices)
		.filter(([id]) => presentIds.includes(id))
		.slice(-MAX_ENTRIES);
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
export function writeOpenChoices(
	choices: OpenChoices,
	presentIds: readonly string[],
): void {
	try {
		const secure = window.location.protocol === "https:" ? "; Secure" : "";
		document.cookie = `${OPEN_COOKIE}=${serializeOpenChoices(choices, presentIds)}; path=/account; max-age=${MAX_AGE_S}; SameSite=Lax${secure}`;
	} catch {
		// Cookies are blocked.
	}
}

/**
 * The one finding that is open. A finding the reader showed wins (the first
 * such); otherwise the first finding opens unless the reader hid it.
 */
export function resolveOpenId(
	ids: readonly string[],
	saved: OpenChoices,
): string | null {
	const shown = ids.find((id) => saved[id] === true);
	if (shown) return shown;
	const first = ids[0];
	return first !== undefined && saved[first] !== false ? first : null;
}
