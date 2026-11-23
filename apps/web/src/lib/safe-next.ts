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

export function signInThen(path: string): string {
	return `/signin?next=${encodeURIComponent(path)}`;
}

const NEXT_STORAGE = "sl_next";
/** How long a remembered return path survives: the magic-link email's life. */
const NEXT_TTL_MS = 15 * 60 * 1000;

/** Read at call time so the page needs no Suspense boundary for `useSearchParams`. */
export function currentNext(): string {
	if (typeof window === "undefined") return "/account";
	return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export function codeStepEmail(search: string): string | null {
	const email = new URLSearchParams(search).get("email")?.trim() ?? "";
	return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
		? email
		: null;
}

export function rememberNext(path: string, now = Date.now()): void {
	try {
		if (path === "/account") localStorage.removeItem(NEXT_STORAGE);
		else localStorage.setItem(NEXT_STORAGE, JSON.stringify({ path, at: now }));
	} catch {}
}

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
