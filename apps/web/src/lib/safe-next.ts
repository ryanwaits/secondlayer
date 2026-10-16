const ORIGIN = "http://next.invalid";

/**
 * A sign-in return path that is safe to redirect to: same-origin and rooted at
 * `/`. Anything else (`//evil.com`, `https://…`, `/\evil.com`, `javascript:`)
 * falls back, so a crafted `?next=` can't send a fresh session off-site.
 */
export function safeNextPath(
	raw: string | null | undefined,
	fallback = "/account",
): string {
	if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
	if (/[\\\u0000-\u001f]/.test(raw)) return fallback;
	try {
		const url = new URL(raw, ORIGIN);
		if (url.origin !== ORIGIN) return fallback;
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return fallback;
	}
}

/** Where a signed-out visitor on `path` goes to sign in and come back. */
export function signInThen(path: string): string {
	return `/signin?next=${encodeURIComponent(path)}`;
}

const NEXT_STORAGE = "sl_next";
/** How long a remembered return path survives: the magic-link email's life. */
const NEXT_TTL_MS = 15 * 60 * 1000;

/** The sign-in page's `?next=`, checked. Read at call time so the page needs
 *  no Suspense boundary for `useSearchParams`. */
export function currentNext(): string {
	if (typeof window === "undefined") return "/account";
	return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

/** Keep the return path for the emailed link, which opens in a new tab. */
export function rememberNext(path: string, now = Date.now()): void {
	try {
		if (path === "/account") localStorage.removeItem(NEXT_STORAGE);
		else localStorage.setItem(NEXT_STORAGE, JSON.stringify({ path, at: now }));
	} catch {
		// Storage blocked: the emailed link lands on /account instead.
	}
}

/** The remembered return path, once; `/account` when none or expired. */
export function takeRememberedNext(now = Date.now()): string {
	try {
		const raw = localStorage.getItem(NEXT_STORAGE);
		localStorage.removeItem(NEXT_STORAGE);
		if (!raw) return "/account";
		const { path, at } = JSON.parse(raw) as { path?: string; at?: number };
		if (typeof at !== "number" || now - at > NEXT_TTL_MS) return "/account";
		return safeNextPath(path);
	} catch {
		return "/account";
	}
}
