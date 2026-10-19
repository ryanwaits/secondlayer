import { countedKeys, isOwnKey } from "@/components/account/keys/key-view";
import type { ApiKey } from "./types";

/** The first read: five transfers, one command, free. */
export const READ_COMMAND = "sl index ft-transfers --limit 5";

export interface OnboardingProgress {
	/** An own key exists. */
	key: boolean;
	/** Some own key has read something. */
	read: boolean;
	/** A webhook or a subgraph exists. */
	push: boolean;
	/** The account is underway: it has read, or set up a webhook or subgraph. The normal screens show. */
	complete: boolean;
}

/** True while the keys have loaded and the account has no key of its own. */
export function hasNoKey(keys: ApiKey[] | null, now: Date): boolean {
	return keys !== null && countedKeys(keys, now).length === 0;
}

/** Where the account stands on keys of its own (docs keys never count). */
export type KeyState = "loading" | "first" | "none_active" | "active";

/** `first`: never made a key, so a new account. `none_active`: had keys and
 *  revoked them all; its webhooks and subgraphs keep running. */
export function keyState(keys: ApiKey[] | null, now: Date): KeyState {
	if (keys === null) return "loading";
	if (countedKeys(keys, now).length > 0) return "active";
	const everHad = keys.some((k) => isOwnKey(k.product) && k.product !== "docs");
	return everHad ? "none_active" : "first";
}

/** Where a new account is on its way to its first key and first read. */
export function onboardingProgress(
	keys: ApiKey[] | null,
	now: Date,
	pushed: boolean,
): OnboardingProgress {
	const own = countedKeys(keys, now);
	const key = own.length > 0;
	const read = own.some((k) => k.lastUsedAt !== null);
	return { key, read, push: pushed, complete: key && (read || pushed) };
}

/** The prompt the first-rows guide hands to a coding assistant: learn the API, make one call, then ask. */
export const FIRST_ROWS_PROMPT = `I have a Secondlayer API key in \`SECONDLAYER_API_KEY\`.

1. Read https://www.secondlayer.tools/llms.txt to learn the Index API.
2. Call \`GET https://api.secondlayer.tools/v1/index/ft-transfers?limit=5\` with \`Authorization: Bearer $SECONDLAYER_API_KEY\` and show me the rows.
3. Ask me what I'm building, then suggest the endpoints that fit.`;

const skipKey = (accountId: string) => `sl:onboarding-skipped:${accountId}`;

/** Whether this browser skipped the checklist for this account. Storage is optional: unreadable means not skipped. */
export function onboardingSkipped(accountId: string): boolean {
	try {
		return localStorage.getItem(skipKey(accountId)) !== null;
	} catch {
		return false;
	}
}

export function skipOnboarding(accountId: string): void {
	try {
		localStorage.setItem(skipKey(accountId), new Date().toISOString());
	} catch {
		// Storage is optional; the checklist just hides for this visit.
	}
}
