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
