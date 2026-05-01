import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
	appendFileSync,
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { getInstanceMode } from "../mode.ts";

/**
 * AES-256-GCM symmetric envelope for encrypted secrets at rest (tenant keys,
 * subscription signing secrets, etc.).
 *
 * Ciphertext layout: `iv (12 bytes) || authTag (16 bytes) || ciphertext`
 *
 * The key comes from `SECONDLAYER_SECRETS_KEY` — 32 bytes hex. In OSS mode,
 * if the env var is unset on first use we autogenerate a key and persist it
 * to `.env.local` in the current working directory so subsequent restarts
 * pick it up without user intervention. Dedicated/platform modes throw —
 * those runtimes must provision the key explicitly.
 *
 * Rotation strategy: re-encrypt all rows with the new key and swap the env
 * var. Not zero-downtime, but acceptable at v2 scale. For real KMS (AWS
 * KMS, Vault, GCP KMS), wrap the same byte layout behind an
 * `EncryptSecret`/`DecryptSecret` interface and swap at startup.
 */

const KEY_ENV = "SECONDLAYER_SECRETS_KEY";
const IV_LEN = 12;
const TAG_LEN = 16;

function readExistingKey(envPath: string): string | null {
	if (!existsSync(envPath)) return null;
	const contents = readFileSync(envPath, "utf8");
	const match = contents.match(/^SECONDLAYER_SECRETS_KEY=([a-fA-F0-9]{64})/m);
	// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
	return match ? match[1]! : null;
}

/**
 * Atomic file lock via `openSync(..., "wx")` — O_CREAT | O_EXCL. If two
 * processes race on cold-compose start, exactly one creates the lock
 * file; the loser polls until the winner finishes writing `.env.local`,
 * then reads the winner's key. Stale locks (process crashed mid-write)
 * are cleaned after `STALE_LOCK_MS`.
 */
const STALE_LOCK_MS = 10_000;
const POLL_MS = 25;

function bootstrapOssKey(): string {
	const envPath = resolve(process.cwd(), ".env.local");

	// Fast path — key already on disk from a prior run.
	const existing = readExistingKey(envPath);
	if (existing) {
		process.env[KEY_ENV] = existing;
		return existing;
	}

	const lockPath = `${envPath}.secret-bootstrap.lock`;
	let lockFd: number | null = null;
	try {
		lockFd = openSync(lockPath, "wx", 0o600);
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code !== "EEXIST") throw err;
	}

	if (lockFd === null) {
		// Another process is bootstrapping. Poll for its result.
		const deadline = Date.now() + STALE_LOCK_MS;
		while (Date.now() < deadline) {
			const key = readExistingKey(envPath);
			if (key) {
				process.env[KEY_ENV] = key;
				return key;
			}
			Bun.sleepSync(POLL_MS);
		}
		// Lock holder died mid-write — force-clean and retry once.
		try {
			unlinkSync(lockPath);
		} catch {}
		return bootstrapOssKey();
	}

	try {
		const hex = randomBytes(32).toString("hex");
		const line = `${existsSync(envPath) ? "\n" : ""}${KEY_ENV}=${hex}\n`;
		appendFileSync(envPath, line, { mode: 0o600 });
		process.env[KEY_ENV] = hex;
		console.log(
			`[secondlayer] generated ${KEY_ENV}; saved to ${envPath} (mode 0600)`,
		);
		return hex;
	} finally {
		closeSync(lockFd);
		try {
			unlinkSync(lockPath);
		} catch {}
	}
}

function loadKey(): Buffer {
	let hex = process.env[KEY_ENV];
	if (!hex) {
		if (getInstanceMode() === "oss") {
			hex = bootstrapOssKey();
		} else {
			throw new Error(
				`${KEY_ENV} not set. Generate one with: openssl rand -hex 32`,
			);
		}
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
