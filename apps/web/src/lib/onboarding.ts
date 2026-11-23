import { countedKeys, isOwnKey } from "@/components/account/keys/key-view";
import type { ApiKey } from "./types";

export const READ_COMMAND = "sl index ft-transfers --order desc --limit 5";

export interface OnboardingProgress {
	key: boolean;
	read: boolean;
	push: boolean;
	complete: boolean;
}

export function hasNoKey(keys: ApiKey[] | null, now: Date): boolean {
	return keys !== null && countedKeys(keys, now).length === 0;
}

export type KeyState = "loading" | "first" | "none_active" | "active";

export function keyState(keys: ApiKey[] | null, now: Date): KeyState {
	if (keys === null) return "loading";
	if (countedKeys(keys, now).length > 0) return "active";
	const everHad = keys.some((k) => isOwnKey(k.product) && k.product !== "docs");
	return everHad ? "none_active" : "first";
}

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
 * Skipping lives in the browser, so it can only hide a guide whose blocks were
 * sent. `pushed` is true only for a webhook or subgraph the server saw; unread
 * keys or lists keep the blocks.
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

export const FIRST_ROWS_PROMPT = `I have a Secondlayer API key in \`SECONDLAYER_API_KEY\`.

1. Read https://www.secondlayer.tools/llms.txt to learn the Index API.
2. Call \`GET https://api.secondlayer.tools/v1/index/ft-transfers?limit=5&order=desc\` with \`Authorization: Bearer $SECONDLAYER_API_KEY\` and show me the rows.
3. Ask me what I'm building, then suggest the endpoints that fit.`;

const skipKey = (accountId: string) => `sl:onboarding-skipped:${accountId}`;

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
	} catch {}
}
