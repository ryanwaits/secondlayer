/** Where the reader's docs key lives for the tab (sessionStorage, never a cookie or a URL). */
export const DOCS_KEY_STORE = "sl-docs-key";

/** Fired on sign-out so a loaded key module drops the key it holds in memory. */
export const DOCS_KEY_FORGET = "sl-docs-key-forget";

/** The owner a signed-out reader's key is stored under (an account's is its id). */
export const ANON_OWNER = "anon";

/**
 * Signed out: drop a stored key that belonged to an account, so signing out
 * takes the account's docs key off the tab. A signed-out reader's own key stays.
 */
export function dropAccountKey(): void {
	let owner: unknown;
	try {
		const raw = sessionStorage.getItem(DOCS_KEY_STORE);
		if (!raw) return;
		owner = (JSON.parse(raw) as { accountId?: unknown }).accountId;
	} catch {
		owner = null;
	}
	if (owner === ANON_OWNER) return;
	try {
		sessionStorage.removeItem(DOCS_KEY_STORE);
	} catch {
		// Storage is optional.
	}
	window.dispatchEvent(new Event(DOCS_KEY_FORGET));
}
