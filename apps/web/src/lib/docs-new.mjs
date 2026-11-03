/**
 * How long a docs "New" row keeps its chip. Which rows get one is derived from
 * git history (see docs-new-rule.mjs, written to src/generated/docs-new.json by
 * `bun run docs:new`); this file holds only what the client sidebar needs, so
 * it stays free of Node imports.
 */

/** How long a row keeps its chip. */
export const NEW_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Whether a row dated `date` still shows its chip at `now` (ms).
 * @param {string | undefined} date
 * @param {number} now
 */
export function isFresh(date, now) {
	if (!date) return false;
	const at = Date.parse(date);
	return Number.isFinite(at) && now >= at && now - at < NEW_DAYS * DAY_MS;
}
