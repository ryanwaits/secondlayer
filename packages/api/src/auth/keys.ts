const API_KEY_PREFIX = "sk-sl_";
/** Sentinel product keys get their own prefix so they can't be mistaken for an
 *  account key. Lookups are by hash, so older `sk-sl_` Sentinel keys still resolve. */
export const SENTINEL_KEY_PREFIX = "sk-snt_";
const SESSION_PREFIX = "ss-sl_";

export function hashToken(raw: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(raw);
	return hasher.digest("hex");
}

function generateToken(prefix: string): {
	raw: string;
	hash: string;
	prefix: string;
} {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	const raw = `${prefix}${hex}`;
	const hash = hashToken(raw);
	const tokenPrefix = `${prefix}${hex.slice(0, 8)}`;
	return { raw, hash, prefix: tokenPrefix };
}

export function generateApiKey(prefix: string = API_KEY_PREFIX): {
	raw: string;
	hash: string;
	prefix: string;
} {
	return generateToken(prefix);
}

export function generateSessionToken(): {
	raw: string;
	hash: string;
	prefix: string;
} {
	return generateToken(SESSION_PREFIX);
}
