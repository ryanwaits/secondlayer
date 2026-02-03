const API_KEY_PREFIX = "sk-sl_";
const SESSION_PREFIX = "ss-sl_";

export function hashToken(raw: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(raw);
  return hasher.digest("hex");
}

/** @deprecated Use hashToken */
export const hashApiKey = hashToken;

function generateToken(prefix: string): { raw: string; hash: string; prefix: string } {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const raw = `${prefix}${hex}`;
  const hash = hashToken(raw);
  const tokenPrefix = `${prefix}${hex.slice(0, 8)}`;
  return { raw, hash, prefix: tokenPrefix };
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  return generateToken(API_KEY_PREFIX);
}

export function generateSessionToken(): { raw: string; hash: string; prefix: string } {
  return generateToken(SESSION_PREFIX);
}
