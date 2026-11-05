/**
 * What this browser knows about its reader's place on the updates list, so
 * the signup form steps aside for someone already on it. Readers without an
 * account have nothing else; signed-in readers get the account's answer
 * instead. A per-browser convenience only: storage can be empty, blocked or
 * throw, and the form then simply shows.
 *
 *   pending    joined here, confirmation link not clicked yet (no token)
 *   confirmed  confirmed or resubscribed here; token is the unsubscribe link's
 */
export type UpdatesMemory =
	| { status: "pending"; email: string }
	| { status: "confirmed"; email: string; token: string };

const KEY = "sl-updates";

export function readUpdatesMemory(): UpdatesMemory | null {
	try {
		const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
		if (typeof value?.email !== "string") return null;
		if (value.status === "pending") {
			return { status: "pending", email: value.email };
		}
		if (value.status === "confirmed" && typeof value.token === "string") {
			return { status: "confirmed", email: value.email, token: value.token };
		}
		return null;
	} catch {
		return null;
	}
}

export function rememberUpdates(memory: UpdatesMemory): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(memory));
	} catch {}
}

export function forgetUpdates(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {}
}
