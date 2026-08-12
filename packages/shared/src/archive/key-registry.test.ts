import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { loadEd25519PrivateKey, signEd25519 } from "../crypto/ed25519.ts";
import {
	type KeyRegistry,
	canonicalRegistryPayload,
	checkKeyTrust,
	keyIdFor,
	publicKeyFor,
	verifyRegistry,
} from "./key-registry.ts";

/**
 * The fixture matrix P1.14 asks for: active, rotated, retired, unknown,
 * compromised, and a lost/unsigned registry.
 *
 * The pair that matters most is retired vs compromised. They look identical to
 * a naive "is this key current?" check, and conflating them either destroys the
 * published history on every rotation or keeps accepting forgeries after a leak.
 */

function keypair() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return {
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
	};
}

const ROOT = keypair();
const ONLINE = keypair();
const OLD = keypair();
const LEAKED = keypair();

function registry(overrides: Partial<KeyRegistry> = {}): KeyRegistry {
	const base: KeyRegistry = {
		schema_version: 1,
		network: "mainnet",
		updated_at: "2026-08-01T00:00:00.000Z",
		keys: [
			{
				key_id: keyIdFor(ONLINE.publicPem),
				public_key_pem: ONLINE.publicPem,
				status: "active",
				valid_from: "2026-06-01T00:00:00.000Z",
				valid_until: null,
			},
			{
				key_id: keyIdFor(OLD.publicPem),
				public_key_pem: OLD.publicPem,
				status: "retired",
				valid_from: "2026-01-01T00:00:00.000Z",
				valid_until: "2026-06-01T00:00:00.000Z",
			},
			{
				key_id: keyIdFor(LEAKED.publicPem),
				public_key_pem: LEAKED.publicPem,
				status: "compromised",
				valid_from: "2026-02-01T00:00:00.000Z",
				valid_until: "2026-05-01T00:00:00.000Z",
				compromised_at: "2026-05-01T00:00:00.000Z",
			},
		],
		...overrides,
	};
	return base;
}

function signed(reg: KeyRegistry, privatePem = ROOT.privatePem): KeyRegistry {
	return {
		...reg,
		signature: signEd25519(
			canonicalRegistryPayload(reg),
			loadEd25519PrivateKey(privatePem),
		),
		root_key_id: keyIdFor(ROOT.publicPem),
	};
}

describe("registry authenticity", () => {
	test("a root-signed registry verifies against the pinned root", () => {
		expect(verifyRegistry(signed(registry()), ROOT.publicPem).trusted).toBe(
			true,
		);
	});

	test("an unsigned registry is refused", () => {
		const result = verifyRegistry(registry(), ROOT.publicPem);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("registry-unsigned");
	});

	test("a registry signed by a non-root key is refused", () => {
		// Otherwise anyone who can serve a registry nominates their own signer.
		const impostor = keypair();
		const result = verifyRegistry(
			signed(registry(), impostor.privatePem),
			ROOT.publicPem,
		);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("registry-signature-invalid");
	});

	test("a tampered registry fails against the correct root", () => {
		const reg = signed(registry());
		// Add a key the root never approved.
		const rogue = keypair();
		reg.keys.push({
			key_id: keyIdFor(rogue.publicPem),
			public_key_pem: rogue.publicPem,
			status: "active",
			valid_from: "2026-01-01T00:00:00.000Z",
			valid_until: null,
		});
		expect(verifyRegistry(reg, ROOT.publicPem).trusted).toBe(false);
	});
});

describe("key trust over time", () => {
	const reg = registry();

	test("an active key signing now is trusted", () => {
		const result = checkKeyTrust(
			reg,
			keyIdFor(ONLINE.publicPem),
			"2026-08-12T00:00:00.000Z",
		);
		expect(result.trusted).toBe(true);
	});

	test("a RETIRED key still vouches for what it signed while valid", () => {
		// The property that makes rotation survivable. Without it, every rotation
		// would invalidate the entire published archive history.
		const result = checkKeyTrust(
			reg,
			keyIdFor(OLD.publicPem),
			"2026-03-01T00:00:00.000Z",
		);
		expect(result.trusted).toBe(true);
		expect(result.detail).toContain("while it was valid");
	});

	test("a retired key cannot sign anything after retirement", () => {
		const result = checkKeyTrust(
			reg,
			keyIdFor(OLD.publicPem),
			"2026-08-12T00:00:00.000Z",
		);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("signed-outside-validity");
	});

	test("a COMPROMISED key is refused even for objects signed while valid", () => {
		// The inverse of retirement: an attacker holding the key could have
		// backdated anything, so history signed by it is suspect too.
		const result = checkKeyTrust(
			reg,
			keyIdFor(LEAKED.publicPem),
			"2026-03-01T00:00:00.000Z",
		);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("key-compromised");
	});

	test("an unknown key is refused", () => {
		const stranger = keypair();
		const result = checkKeyTrust(
			reg,
			keyIdFor(stranger.publicPem),
			"2026-08-12T00:00:00.000Z",
		);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("unknown-key");
	});

	test("an object predating its key's validity is refused", () => {
		const result = checkKeyTrust(
			reg,
			keyIdFor(ONLINE.publicPem),
			"2026-01-01T00:00:00.000Z",
		);
		expect(result.trusted).toBe(false);
		expect(result.reason).toBe("signed-outside-validity");
	});

	test("an unparseable timestamp is refused rather than assumed valid", () => {
		expect(
			checkKeyTrust(reg, keyIdFor(ONLINE.publicPem), "not-a-date").trusted,
		).toBe(false);
	});
});

describe("key lookup", () => {
	test("resolves a registered key's public PEM", () => {
		expect(publicKeyFor(registry(), keyIdFor(ONLINE.publicPem))).toBe(
			ONLINE.publicPem,
		);
	});

	test("returns undefined for an unregistered key", () => {
		expect(publicKeyFor(registry(), "nope")).toBeUndefined();
	});
});
