import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
	BACKUP_MANIFEST_VERSION,
	type BackupManifest,
	decryptBundle,
	encryptBundle,
	keyMatchesCanary,
	planBackup,
	precheckRestore,
	sealKeyCanary,
} from "./backup.ts";

const KEY = randomBytes(32).toString("hex");
const OTHER_KEY = randomBytes(32).toString("hex");

function manifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
	return {
		schema_version: BACKUP_MANIFEST_VERSION,
		created_at: "2026-08-15T00:00:00.000Z",
		network: "mainnet",
		parts: ["db", "config", "keys", "handlers", "scope"],
		encrypted: true,
		scope: { from_height: 0, to_height: 100 },
		db: { file: "db.dump", sha256: "abc", bytes: 1, format: "pg_dump-custom" },
		secrets: {
			file: "secrets.enc",
			encrypted: true,
			canary: sealKeyCanary(KEY),
		},
		...overrides,
	};
}

describe("backup planning", () => {
	test("refuses to write secrets in plaintext", () => {
		// A bundle that leaks every key is worse than no bundle.
		const plan = planBackup({
			network: "mainnet",
			fromHeight: 0,
			includeSecrets: true,
			secretsEncrypted: false,
			canary: sealKeyCanary(KEY),
		});
		expect(plan.ok).toBe(false);
		if (!plan.ok) expect(plan.reason).toContain("plaintext");
	});

	test("refuses a secrets bundle with no canary", () => {
		// Without it a restore cannot prove the key matches, which is the whole
		// failure this design exists to prevent.
		const plan = planBackup({
			network: "mainnet",
			fromHeight: 0,
			includeSecrets: true,
			secretsEncrypted: true,
		});
		expect(plan.ok).toBe(false);
		if (!plan.ok) expect(plan.reason).toContain("canary");
	});

	test("a keyless bundle is allowed but does not claim to hold keys", () => {
		const plan = planBackup({
			network: "mainnet",
			fromHeight: 0,
			includeSecrets: false,
			secretsEncrypted: false,
		});
		expect(plan.ok).toBe(true);
		if (plan.ok) expect(plan.manifest.parts).not.toContain("keys");
	});

	test("rejects an inverted height range", () => {
		const plan = planBackup({
			network: "mainnet",
			fromHeight: 500,
			toHeight: 100,
			includeSecrets: false,
			secretsEncrypted: false,
		});
		expect(plan.ok).toBe(false);
	});
});

describe("secrets key canary", () => {
	test("the sealing key opens it", () => {
		expect(keyMatchesCanary(sealKeyCanary(KEY), KEY)).toBe(true);
	});

	test("a different key does not", () => {
		expect(keyMatchesCanary(sealKeyCanary(KEY), OTHER_KEY)).toBe(false);
	});

	test("a malformed key is a mismatch, not a crash", () => {
		expect(keyMatchesCanary(sealKeyCanary(KEY), "not-hex")).toBe(false);
		expect(keyMatchesCanary("garbage", KEY)).toBe(false);
	});

	test("sealing twice produces different ciphertext", () => {
		// Fresh IV per seal; identical output would leak that two backups share
		// a key.
		expect(sealKeyCanary(KEY)).not.toBe(sealKeyCanary(KEY));
	});
});

describe("bundle encryption", () => {
	test("round-trips under the right passphrase", () => {
		const sealed = encryptBundle("INSTANCE_TOKEN=abc", "correct horse");
		expect(decryptBundle(sealed, "correct horse")).toBe("INSTANCE_TOKEN=abc");
	});

	test("a wrong passphrase throws rather than returning garbage", () => {
		const sealed = encryptBundle("INSTANCE_TOKEN=abc", "correct horse");
		expect(() => decryptBundle(sealed, "wrong")).toThrow();
	});

	test("an empty passphrase is refused", () => {
		expect(() => encryptBundle("x", "")).toThrow();
	});
});

describe("restore precheck", () => {
	test("a matching key and empty target passes", () => {
		const result = precheckRestore({
			manifest: manifest(),
			targetNetwork: "mainnet",
			targetIsEmpty: true,
			force: false,
			secretsKeyHex: KEY,
		});
		expect(result.ok).toBe(true);
	});

	test("a mismatched secrets key is refused as fatal", () => {
		// THE failure this guards: restore with the wrong key and every encrypted
		// column becomes permanently unreadable, silently. `force` must not help.
		const result = precheckRestore({
			manifest: manifest(),
			targetNetwork: "mainnet",
			targetIsEmpty: true,
			force: true,
			secretsKeyHex: OTHER_KEY,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.fatal).toBe(true);
			expect(result.reason).toContain("permanently unreadable");
		}
	});

	test("a missing secrets key is refused before anything is written", () => {
		const result = precheckRestore({
			manifest: manifest(),
			targetNetwork: "mainnet",
			targetIsEmpty: true,
			force: false,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.fatal).toBe(false);
	});

	test("a non-empty target is refused unless forced", () => {
		const base = {
			manifest: manifest(),
			targetNetwork: "mainnet",
			targetIsEmpty: false,
			secretsKeyHex: KEY,
		};
		expect(precheckRestore({ ...base, force: false }).ok).toBe(false);
		expect(precheckRestore({ ...base, force: true }).ok).toBe(true);
	});

	test("a cross-network restore is always refused", () => {
		// Testnet rows in a mainnet index is corruption that verify would later
		// report as divergence with no obvious cause.
		const result = precheckRestore({
			manifest: manifest({ network: "testnet" }),
			targetNetwork: "mainnet",
			targetIsEmpty: true,
			force: true,
			secretsKeyHex: KEY,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.fatal).toBe(true);
	});

	test("an unsupported bundle version is refused", () => {
		const result = precheckRestore({
			manifest: manifest({ schema_version: 99 }),
			targetNetwork: "mainnet",
			targetIsEmpty: true,
			force: true,
			secretsKeyHex: KEY,
		});
		expect(result.ok).toBe(false);
	});

	test("a keyless bundle needs no secrets key", () => {
		const result = precheckRestore({
			manifest: manifest({ secrets: null, parts: ["db", "config", "scope"] }),
			targetNetwork: "mainnet",
			targetIsEmpty: true,
			force: false,
		});
		expect(result.ok).toBe(true);
	});
});
