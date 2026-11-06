import { countedKeys, isOwnKey } from "@/components/account/keys/key-view";
import type { ApiKey } from "./types";

/** The first read: the five newest transfers, one command, free. */
export const READ_COMMAND = "sl index ft-transfers --order desc --limit 5";

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

/**
 * Whether the server must render the first-rows guide's code blocks: false
 * only when the guide is certain not to show. It shows for an account that
 * never made a key, or has a key and is not underway (`checklistApplies`);
 * the name-a-key flow starts only from the first case, so a key made in the
 * page needs no later render. Skipping lives in the browser, so it can only
 * hide a guide whose blocks were sent. `pushed` is true only for a webhook
 * or subgraph the server saw; unread keys or lists keep the blocks.
 */
export function firstRowsGuideMayShow(
	keys: ApiKey[] | null,
	now: Date,
	pushed: boolean,
): boolean {
	const state = keyState(keys, now);
	if (state === "loading" || state === "first") return true;
	if (state === "none_active") return false;
	return !onboardingProgress(keys, now, pushed).complete;
}

/** The prompt the first-rows guide hands to a coding assistant: learn the API, make one call, then ask. */
export const FIRST_ROWS_PROMPT = `I have a Secondlayer API key in \`SECONDLAYER_API_KEY\`.

1. Read https://www.secondlayer.tools/llms.txt to learn the Index API.
2. Call \`GET https://api.secondlayer.tools/v1/index/ft-transfers?limit=5&order=desc\` with \`Authorization: Bearer $SECONDLAYER_API_KEY\` and show me the rows.
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
