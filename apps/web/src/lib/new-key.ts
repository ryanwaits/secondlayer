/**
 * Sign-in mints a first API key and hands it to /account, which shows it once.
 * sessionStorage keeps it to this tab; it's cleared as soon as it's read.
 */
const NEW_KEY_STORAGE = "sl_new_key";

export function handOverNewKey(key: string | undefined): void {
	if (!key) return;
	try {
		sessionStorage.setItem(NEW_KEY_STORAGE, key);
	} catch {
		// Storage blocked: /account still offers "Create a new key".
	}
}

export function takeHandedOverKey(): string | null {
	try {
		const key = sessionStorage.getItem(NEW_KEY_STORAGE);
		if (key) sessionStorage.removeItem(NEW_KEY_STORAGE);
		return key;
	} catch {
		return null;
	}
}
