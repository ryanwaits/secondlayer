/**
 * Backup bundle — the index, the operator's keys, and the scope they cover.
 *
 * This file holds the pure parts: manifest shape, validation, bundle
 * encryption, and the key canary. The IO (pg_dump, pg_restore, reading and
 * writing bundle files) lives in the CLI command, so everything here stays
 * testable without a database or a filesystem.
 *
 * ## Why there is a canary
 *
 * `SECONDLAYER_SECRETS_KEY` encrypts columns in the database — subgraph
 * connection strings, subscription signing secrets. In OSS mode, if that key is
 * missing when something first needs it, the runtime GENERATES A NEW ONE and
 * persists it (see `crypto/secrets.ts`). That behaviour is right for a fresh
 * install and catastrophic for a restore: bring the database back without its
 * original key and the runtime quietly mints a different one, leaving every
 * encrypted column permanently unreadable. Nothing errors. You find out later.
 *
 * So a backup seals a known plaintext under the live key and stores the
 * ciphertext in the manifest. Restore opens it with the key it is about to
 * install, and refuses if it does not match. That converts a silent, permanent
 * data loss into a loud failure before anything is written.
 */
import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
	timingSafeEqual,
} from "node:crypto";

export const BACKUP_MANIFEST_VERSION = 1;

export const BACKUP_PARTS = [
	"db",
	"config",
	"keys",
	"handlers",
	"scope",
] as const;
export type BackupPart = (typeof BACKUP_PARTS)[number];

/**
 * Sealed under the secrets key at backup time and opened at restore time. The
 * value is arbitrary; only the round-trip matters.
 */
const CANARY_PLAINTEXT = "secondlayer-secrets-key-canary-v1";

const IV_LEN = 12;
const TAG_LEN = 16;
const SALT_LEN = 16;
/** Deliberately expensive: bundle passphrases are chosen by humans. */
const SCRYPT_COST = 2 ** 15;
/**
 * scrypt needs ~128 * N * r bytes (r defaults to 8), which is just over Node's
 * 32 MB default cap at this cost. Raising the ceiling rather than weakening the
 * KDF — the whole point of the cost is that it is uncomfortable.
 */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SCRYPT_OPTS = { N: SCRYPT_COST, maxmem: SCRYPT_MAXMEM } as const;

export type BackupManifest = {
	schema_version: number;
	created_at: string;
	network: string;
	parts: BackupPart[];
	encrypted: boolean;
	scope: { from_height: number; to_height: number | null };
	db: {
		file: string;
		sha256: string;
		bytes: number;
		format: string;
	} | null;
	/** Never the secrets themselves — only how to check them. */
	secrets: {
		file: string;
		encrypted: boolean;
		canary: string;
	} | null;
	signature?: string;
	key_id?: string;
};

export type BackupPlan =
	| { ok: true; manifest: BackupManifest }
	| { ok: false; reason: string };

/**
 * Validate a backup before any bytes are written. Refusing early is the whole
 * point: a bundle that omits the keys looks like a backup and is not one.
 */
export function planBackup(input: {
	network: string;
	fromHeight: number;
	toHeight?: number | null;
	includeSecrets: boolean;
	secretsEncrypted: boolean;
	canary?: string;
	now?: string;
}): BackupPlan {
	if (input.fromHeight < 0) {
		return { ok: false, reason: "scope from_height must be >= 0" };
	}
	if (
		input.toHeight !== null &&
		input.toHeight !== undefined &&
		input.toHeight < input.fromHeight
	) {
		return { ok: false, reason: "scope to_height is below from_height" };
	}
	if (input.includeSecrets && !input.secretsEncrypted) {
		return {
			ok: false,
			reason:
				"refusing to write plaintext secrets; supply a passphrase or pass the explicit plaintext override",
		};
	}
	if (input.includeSecrets && !input.canary) {
		return {
			ok: false,
			reason:
				"secrets bundle requires a key canary so a restore can prove the key matches",
		};
	}

	const parts: BackupPart[] = input.includeSecrets
		? [...BACKUP_PARTS]
		: BACKUP_PARTS.filter((p) => p !== "keys");

	return {
		ok: true,
		manifest: {
			schema_version: BACKUP_MANIFEST_VERSION,
			created_at: input.now ?? new Date().toISOString(),
			network: input.network,
			parts,
			encrypted: input.secretsEncrypted,
			scope: {
				from_height: input.fromHeight,
				to_height: input.toHeight ?? null,
			},
			db: null,
			secrets: null,
		},
	};
}

function secretsKeyBuffer(hexKey: string): Buffer {
	const key = Buffer.from(hexKey.trim(), "hex");
	if (key.length !== 32) {
		throw new Error("SECONDLAYER_SECRETS_KEY must be 32 bytes hex");
	}
	return key;
}

/**
 * Seal the canary under an EXPLICIT key.
 *
 * Deliberately not reusing `crypto/secrets.ts`: that module resolves the key
 * from the ambient environment and, in OSS mode, generates and persists one as
 * a side effect when it is missing. Calling it here would mean a backup could
 * mint the very key it is supposed to be preserving.
 */
export function sealKeyCanary(secretsKeyHex: string): string {
	const key = secretsKeyBuffer(secretsKeyHex);
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(CANARY_PLAINTEXT, "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
		"base64",
	);
}

/** True only when `secretsKeyHex` is the key the canary was sealed with. */
export function keyMatchesCanary(
	canaryBase64: string,
	secretsKeyHex: string,
): boolean {
	try {
		const key = secretsKeyBuffer(secretsKeyHex);
		const envelope = Buffer.from(canaryBase64, "base64");
		const iv = envelope.subarray(0, IV_LEN);
		const tag = envelope.subarray(IV_LEN, IV_LEN + TAG_LEN);
		const ciphertext = envelope.subarray(IV_LEN + TAG_LEN);
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		const plaintext = Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]);
		const expected = Buffer.from(CANARY_PLAINTEXT, "utf8");
		return (
			plaintext.length === expected.length &&
			timingSafeEqual(plaintext, expected)
		);
	} catch {
		// A wrong key fails the GCM auth tag, which throws. That is a mismatch,
		// not an error to propagate.
		return false;
	}
}

/**
 * Encrypt the secrets bundle under an operator passphrase.
 * Layout: `salt(16) || iv(12) || authTag(16) || ciphertext`.
 */
export function encryptBundle(plaintext: string, passphrase: string): Buffer {
	if (!passphrase) throw new Error("passphrase is required");
	const salt = randomBytes(SALT_LEN);
	const key = scryptSync(passphrase, salt, 32, SCRYPT_OPTS);
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBundle(envelope: Buffer, passphrase: string): string {
	const salt = envelope.subarray(0, SALT_LEN);
	const iv = envelope.subarray(SALT_LEN, SALT_LEN + IV_LEN);
	const tag = envelope.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
	const ciphertext = envelope.subarray(SALT_LEN + IV_LEN + TAG_LEN);
	const key = scryptSync(passphrase, salt, 32, SCRYPT_OPTS);
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

export type RestorePrecheck =
	| { ok: true }
	| { ok: false; reason: string; fatal: boolean };

/**
 * Everything that must hold before a restore writes anything.
 *
 * `fatal` distinguishes "this bundle can never restore here" from "this needs
 * an explicit override" — the caller surfaces them differently.
 */
export function precheckRestore(input: {
	manifest: BackupManifest;
	targetNetwork: string;
	targetIsEmpty: boolean;
	force: boolean;
	secretsKeyHex?: string;
}): RestorePrecheck {
	if (input.manifest.schema_version !== BACKUP_MANIFEST_VERSION) {
		return {
			ok: false,
			fatal: true,
			reason: `bundle schema_version ${input.manifest.schema_version} is not supported (expected ${BACKUP_MANIFEST_VERSION})`,
		};
	}
	if (input.manifest.network !== input.targetNetwork) {
		return {
			ok: false,
			fatal: true,
			reason: `bundle is ${input.manifest.network}; this instance is ${input.targetNetwork}`,
		};
	}
	if (!input.targetIsEmpty && !input.force) {
		return {
			ok: false,
			fatal: false,
			reason:
				"target database already holds chain data; restoring would overwrite it",
		};
	}
	const secrets = input.manifest.secrets;
	if (secrets) {
		if (!input.secretsKeyHex) {
			return {
				ok: false,
				fatal: false,
				reason:
					"bundle carries encrypted columns but no secrets key was supplied; restoring now would leave them unreadable",
			};
		}
		if (!keyMatchesCanary(secrets.canary, input.secretsKeyHex)) {
			return {
				ok: false,
				fatal: true,
				reason:
					"the supplied SECONDLAYER_SECRETS_KEY does not match the one this backup was taken with; encrypted columns would be permanently unreadable",
			};
		}
	}
	return { ok: true };
}
