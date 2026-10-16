/**
 * This tab's last copy of the dashboard stores, so a reload or a Back paints
 * data straight away while the stores refresh it. sessionStorage only: it
 * dies with the tab. Every entry carries the account it belongs to and when
 * it was saved; an entry for another account, an older shape, or older than
 * MAX_AGE_MS reads as nothing.
 */
const PREFIX = "sl:dash:v1:"; // bump v1 when a persisted shape changes
const OWNER_KEY = `${PREFIX}owner`;
export const MAX_AGE_MS = 10 * 60_000;
const MAX_BYTES = 256 * 1024;

type Envelope<T> = { owner: string | null; savedAt: number; data: T };

function area(): Storage | null {
	try {
		return typeof sessionStorage === "undefined" ? null : sessionStorage;
	} catch {
		return null;
	}
}

function read(key: string): string | null {
	try {
		return area()?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function remove(key: string): void {
	try {
		area()?.removeItem(key);
	} catch {}
}

/** The account this tab's snapshots belong to, if known. */
export function currentOwner(): string | null {
	return read(OWNER_KEY);
}

export function setOwner(accountId: string): void {
	try {
		area()?.setItem(OWNER_KEY, accountId);
	} catch {}
}

export function loadSnapshot<T>(name: string): T | null {
	const raw = read(PREFIX + name);
	if (raw === null) return null;
	try {
		const envelope = JSON.parse(raw) as Envelope<T>;
		if (Date.now() - envelope.savedAt > MAX_AGE_MS) return null;
		if (envelope.owner !== currentOwner()) return null;
		return envelope.data;
	} catch {
		return null;
	}
}

export function saveSnapshot<T>(name: string, data: T): void {
	const key = PREFIX + name;
	try {
		const envelope: Envelope<T> = {
			owner: currentOwner(),
			savedAt: Date.now(),
			data,
		};
		const serialized = JSON.stringify(envelope);
		if (serialized.length > MAX_BYTES) {
			remove(key);
			return;
		}
		area()?.setItem(key, serialized);
	} catch {
		// Quota or blocked storage: the tab just starts empty next time.
	}
}

export function removeSnapshot(name: string): void {
	remove(PREFIX + name);
}

/** Removes every snapshot and the owner. */
export function clearSnapshots(): void {
	try {
		const storage = area();
		if (!storage) return;
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key?.startsWith(PREFIX)) keys.push(key);
		}
		for (const key of keys) storage.removeItem(key);
	} catch {}
}
