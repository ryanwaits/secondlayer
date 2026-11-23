import { PUBLIC_API_URL } from "@/lib/public-api";

export const LASTING_KEY_NEXT = "/account/keys?new=1";

/**
 * Signed out, the browser asks the API directly (no cookies), so the API's
 * one-a-day limit counts the reader's IP, not ours, and sends the reader's
 * PostHog id (when known) so the API's mint event joins their pageviews.
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

export type MintFailure =
	| { kind: "daily"; text: string }
	| { kind: "flash"; text: string };

export function mintFailure(status: number, signedIn: boolean): MintFailure {
	if (status === 429)
		return signedIn
			? { kind: "flash", text: "Limit reached" }
			: { kind: "daily", text: "One docs key a day without an account" };
	return { kind: "flash", text: "Try again" };
}

export function codeStepHref(email: string): string {
	const q = new URLSearchParams({ email, next: LASTING_KEY_NEXT });
	return `/signin?${q}`;
}

export function lastsFor(expiresAt: string, now = Date.now()): string {
	const minutes = Math.max(
		1,
		Math.ceil((Date.parse(expiresAt) - now) / 60_000),
	);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
	const hours = Math.floor(minutes / 60);
	return `${hours} hour${hours === 1 ? "" : "s"}`;
}
