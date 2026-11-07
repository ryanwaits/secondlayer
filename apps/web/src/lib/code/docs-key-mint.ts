import { PUBLIC_API_URL } from "@/lib/public-api";

/** Where "Make a lasting key" lands after sign-in: the keys page, New key open. */
export const LASTING_KEY_NEXT = "/account/keys?new=1";

/**
 * The request that mints a docs key. Signed in, the web server mints it from
 * the session cookie. Signed out, the browser asks the API directly (no
 * cookies), so the API's one-a-day limit counts the reader's IP, not ours,
 * and sends the reader's PostHog id (when known) so the API's mint event joins
 * their pageviews.
 */
export function docsKeyMintRequest(
	signedIn: boolean,
	distinctId?: string,
): {
	url: string;
	init: RequestInit;
} {
	return {
		url: signedIn ? "/api/keys/docs" : `${PUBLIC_API_URL}/api/public/docs-key`,
		init: {
			method: "POST",
			credentials: signedIn ? "same-origin" : "omit",
			cache: "no-store",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(signedIn ? {} : { distinctId }),
		},
	};
}

/** Why a mint failed, as the note says it. */
export type MintFailure =
	/** Signed out and already minted today: the note offers a lasting key. */
	| { kind: "daily"; text: string }
	/** Anything else: a short flash on the button. */
	| { kind: "flash"; text: string };

export function mintFailure(status: number, signedIn: boolean): MintFailure {
	if (status === 429)
		return signedIn
			? { kind: "flash", text: "Limit reached" }
			: { kind: "daily", text: "One docs key a day without an account" };
	return { kind: "flash", text: "Try again" };
}

/** The sign-in page opened on its code step for `email`, returning to New key. */
export function codeStepHref(email: string): string {
	const q = new URLSearchParams({ email, next: LASTING_KEY_NEXT });
	return `/signin?${q}`;
}

/** How much longer a key lasts, in words: "23 hours", "1 hour", "40 minutes". */
export function lastsFor(expiresAt: string, now = Date.now()): string {
	const minutes = Math.max(
		1,
		Math.ceil((Date.parse(expiresAt) - now) / 60_000),
	);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
	const hours = Math.floor(minutes / 60);
	return `${hours} hour${hours === 1 ? "" : "s"}`;
}
