import { describe, expect, test } from "bun:test";
import {
	ed25519KeyId,
	generateEd25519KeyPair,
	loadEd25519PrivateKey,
	loadEd25519PublicKey,
	publicKeyPemFromPrivate,
	signEd25519,
	verifyEd25519,
} from "../src/crypto/ed25519.ts";

describe("ed25519", () => {
	const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
	const priv = loadEd25519PrivateKey(privateKeyPem);
	const pub = loadEd25519PublicKey(publicKeyPem);

	test("verifies a signature over the signed payload", () => {
		const sig = signEd25519("hello world", priv);
		expect(verifyEd25519("hello world", sig, pub)).toBe(true);
	});

	test("rejects a tampered payload", () => {
		const sig = signEd25519("hello world", priv);
		expect(verifyEd25519("hello worlD", sig, pub)).toBe(false);
	});

	test("rejects a signature from a different key", () => {
		const other = generateEd25519KeyPair();
		const sig = signEd25519(
			"hello",
			loadEd25519PrivateKey(other.privateKeyPem),
		);
		expect(verifyEd25519("hello", sig, pub)).toBe(false);
	});

	test("rejects malformed signatures without throwing", () => {
		expect(verifyEd25519("hello", "not-base64-!!", pub)).toBe(false);
		expect(verifyEd25519("hello", "", pub)).toBe(false);
	});

	test("derives the public key from the private key", () => {
		expect(publicKeyPemFromPrivate(privateKeyPem)).toBe(publicKeyPem);
	});

	test("key id is stable and key-specific", () => {
		expect(ed25519KeyId(publicKeyPem)).toBe(ed25519KeyId(publicKeyPem));
		expect(ed25519KeyId(publicKeyPem)).not.toBe(
			ed25519KeyId(generateEd25519KeyPair().publicKeyPem),
		);
	});
});
