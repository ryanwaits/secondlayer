/**
 * Which findings the reader left open or closed, remembered per browser.
 * Only insight ids and a boolean are stored; a blocked or failing storage
 * means the default applies.
 */

const KEY = "sl:insight-open:v1";

export type OpenChoices = Readonly<Record<string, boolean>>;

export function readOpenChoices(): OpenChoices {
	try {
		const raw = window.localStorage.getItem(KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(([, v]) => typeof v === "boolean"),
		);
	} catch {
		return {};
	}
}

/** Saves `choices` for the ids still shown; entries for gone ids are dropped. */
export function writeOpenChoices(
	choices: OpenChoices,
	presentIds: readonly string[],
): void {
	try {
		const keep = Object.fromEntries(
			Object.entries(choices).filter(([id]) => presentIds.includes(id)),
		);
		window.localStorage.setItem(KEY, JSON.stringify(keep));
	} catch {
		// Storage is blocked or full: the choice lasts for this visit only.
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
