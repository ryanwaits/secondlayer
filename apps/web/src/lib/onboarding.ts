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
	/** Every step is done: the normal screens show. */
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

/** Where a new account is on its way to its first key, first read and first push. */
export function onboardingProgress(
	keys: ApiKey[] | null,
	now: Date,
	pushed: boolean,
): OnboardingProgress {
	const own = countedKeys(keys, now);
	const key = own.length > 0;
	const read = own.some((k) => k.lastUsedAt !== null);
	return { key, read, push: pushed, complete: key && read && pushed };
}
