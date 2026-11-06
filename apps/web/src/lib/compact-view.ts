/**
 * Whether the viewport was last seen at the phone layout (≤640px). Kept in a
 * small first-party cookie so the server render of /account already shows the
 * right tree. It records the measured viewport, never a sniffed device.
 */

export const COMPACT_COOKIE = "sl_compact";
const MAX_AGE_S = 365 * 24 * 60 * 60;

export function serializeCompact(isCompact: boolean): string {
	return isCompact ? "1" : "0";
}

/** The saved layout; anything malformed is null, so the default applies. */
export function parseCompact(raw: string | null | undefined): boolean | null {
	if (raw === "1") return true;
	if (raw === "0") return false;
	return null;
}

/** A write is only needed when the browser's cookie disagrees with the viewport. */
export function needsCompactWrite(
	saved: boolean | null,
	isCompact: boolean,
): boolean {
	return saved !== isCompact;
}

/** The cookie as the browser holds it now. */
export function readCompact(): boolean | null {
	try {
		const entry = document.cookie
			.split("; ")
			.find((c) => c.startsWith(`${COMPACT_COOKIE}=`));
		return parseCompact(entry?.slice(COMPACT_COOKIE.length + 1));
	} catch {
		return null;
	}
}

/** Writes the cookie from the browser. A blocked cookie only costs the
 *  first-paint match on the next visit. */
export function writeCompact(isCompact: boolean): void {
	try {
		const secure = window.location.protocol === "https:" ? "; Secure" : "";
		document.cookie = `${COMPACT_COOKIE}=${serializeCompact(isCompact)}; path=/account; max-age=${MAX_AGE_S}; SameSite=Lax${secure}`;
	} catch {
		// Cookies are blocked.
	}
}
