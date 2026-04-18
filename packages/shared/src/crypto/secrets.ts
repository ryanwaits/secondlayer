import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM symmetric envelope for workflow signer secrets.
 *
 * Ciphertext layout: `iv (12 bytes) || authTag (16 bytes) || ciphertext`
 *
 * The key comes from `SECONDLAYER_SECRETS_KEY` — 32 bytes hex. Callers must
 * load + cache the key once per process. Rotation strategy: when a customer
 * wants to rotate keys, re-encrypt all rows with the new key and swap the
 * env var. Not zero-downtime, but acceptable at v2 scale.
 *
 * For real KMS (AWS KMS, HashiCorp Vault, GCP KMS), wrap the same byte
 * layout behind an `EncryptSecret` / `DecryptSecret` interface in the
 * runner and swap the implementation at startup.
 */

const KEY_ENV = "SECONDLAYER_SECRETS_KEY";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(): Buffer {
	const hex = process.env[KEY_ENV];
	if (!hex) {
		throw new Error(
			`${KEY_ENV} not set. Generate one with: openssl rand -hex 32`,
		);
	}
	const key = Buffer.from(hex, "hex");
	if (key.length !== 32) {
		throw new Error(`${KEY_ENV} must be 32 bytes hex (got ${key.length})`);
	}
	return key;
}

let _cachedKey: Buffer | null = null;
function getKey(): Buffer {
	if (!_cachedKey) _cachedKey = loadKey();
	return _cachedKey;
}

export function encryptSecret(plaintext: string): Buffer {
	const key = getKey();
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptSecret(envelope: Buffer): string {
	const key = getKey();
	const iv = envelope.subarray(0, IV_LEN);
	const tag = envelope.subarray(IV_LEN, IV_LEN + TAG_LEN);
	const ciphertext = envelope.subarray(IV_LEN + TAG_LEN);
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/** Generate a fresh 32-byte hex key suitable for `SECONDLAYER_SECRETS_KEY`. */
export function generateSecretsKey(): string {
	return randomBytes(32).toString("hex");
}
