import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { getInstanceMode } from "../mode.ts";

/**
 * AES-256-GCM symmetric envelope for encrypted secrets at rest (tenant keys,
 * webhook signing secrets, etc.).
 *
 * Ciphertext layout: `iv (12 bytes) || authTag (16 bytes) || ciphertext`
 *
 * The key comes from `SECONDLAYER_SECRETS_KEY` — 32 bytes hex. In OSS mode,
 * if the env var is unset on first use we autogenerate a key and persist it
 * to `secrets.env` under `DATA_DIR` (a volume, so it survives a container
 * recreate) so subsequent restarts pick it up without user intervention.
 * With no `DATA_DIR` (a bare `bun run`) it goes to `.env.local` in the
 * current working directory. A key already in `.env.local` is carried into
 * `DATA_DIR` on first boot. Dedicated/platform modes throw — those runtimes
 * must provision the key explicitly.
 *
 * Rotation strategy: re-encrypt all rows with the new key and swap the env
 * var. Not zero-downtime, but acceptable at v2 scale. For real KMS (AWS
 * KMS, Vault, GCP KMS), wrap the same byte layout behind an
 * `EncryptSecret`/`DecryptSecret` interface and swap at startup.
 */

const KEY_ENV = "SECONDLAYER_SECRETS_KEY";
const IV_LEN = 12;
const TAG_LEN = 16;

/** Where an OSS instance keeps its generated key: the `DATA_DIR` volume when
 *  there is one, else `.env.local` beside the process. */
function keyFilePath(): string {
	const dataDir = process.env.DATA_DIR?.trim();
	return dataDir
		? resolve(dataDir, "secrets.env")
		: resolve(process.cwd(), ".env.local");
}

/** Where earlier versions wrote the key, before `DATA_DIR` held it. */
function legacyKeyFilePath(): string {
	return resolve(process.cwd(), ".env.local");
}

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
	const envPath = keyFilePath();

	// Fast path — key already on disk from a prior run.
	const existing = readExistingKey(envPath);
	if (existing) {
		process.env[KEY_ENV] = existing;
		return existing;
	}

	mkdirSync(dirname(envPath), { recursive: true });
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
		// A key an earlier version wrote beside the process moves into the volume
		// instead of being replaced: a new key would orphan every secret sealed
		// under it.
		const legacy = legacyKeyFilePath();
		const carried = legacy === envPath ? null : readExistingKey(legacy);
		const hex = carried ?? randomBytes(32).toString("hex");
		const line = `${existsSync(envPath) ? "\n" : ""}${KEY_ENV}=${hex}\n`;
		appendFileSync(envPath, line, { mode: 0o600 });
		process.env[KEY_ENV] = hex;
		console.log(
			`[secondlayer] ${carried ? `moved ${KEY_ENV} from ${legacy} to` : `generated ${KEY_ENV}; saved to`} ${envPath} (mode 0600)`,
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

/**
 * Non-throwing check for whether a secrets key is currently resolvable —
 * same resolution order as {@link loadKey} (env var, then the OSS
 * key file), but never bootstraps a new key (that would
 * generate+persist a key as a side effect of a mere existence check), never
 * throws, and never returns or logs the key itself. Used by callers that
 * need to fail loud on a missing key BEFORE attempting a decrypt (f072).
 */
export function secretsKeyAvailable(): boolean {
	if (process.env[KEY_ENV]) return true;
	if (getInstanceMode() === "oss") {
		return (
			readExistingKey(keyFilePath()) !== null ||
			readExistingKey(legacyKeyFilePath()) !== null
		);
	}
	return false;
}

/**
 * The secrets key as hex, resolved the way encrypt/decrypt resolve it (and
 * bootstrapped the same way in OSS mode). Boot calls this once so every module
 * it spawns inherits the one key through the environment.
 */
export function resolveSecretsKeyHex(): string {
	return getKey().toString("hex");
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
