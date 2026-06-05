import { describe, expect, test } from "bun:test";
import { generateEd25519KeyPair } from "./crypto/ed25519.ts";
import {
	canonicalStreamsBulkManifestPayload,
	signStreamsBulkManifest,
	verifyStreamsBulkManifestSignature,
} from "./streams-bulk-manifest.ts";

const MANIFEST = {
	dataset: "stacks-streams",
	network: "mainnet",
	version: 0,
	generated_at: "2026-06-05T00:00:00.000Z",
	coverage: { from_block: 1, to_block: 100 },
	files: [{ path: "a.parquet", sha256: "deadbeef" }],
};

describe("streams bulk manifest signing", () => {
	const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();

	test("sign → verify round-trips and stamps a key id", () => {
		const signed = signStreamsBulkManifest(MANIFEST, privateKeyPem);
		expect(signed.signature).toBeTruthy();
		expect(signed.key_id).toBeTruthy();
		expect(verifyStreamsBulkManifestSignature(signed, publicKeyPem)).toBe(true);
	});

	test("the signed payload omits the signature envelope fields", () => {
		const signed = signStreamsBulkManifest(MANIFEST, privateKeyPem);
		// Stripping signature/key_id reproduces the exact pre-sign bytes.
		expect(canonicalStreamsBulkManifestPayload(signed)).toBe(
			JSON.stringify(MANIFEST),
		);
	});

	test("a tampered file hash fails verification", () => {
		const signed = signStreamsBulkManifest(MANIFEST, privateKeyPem);
		const tampered = {
			...signed,
			files: [{ path: "a.parquet", sha256: "00000000" }],
		};
		expect(verifyStreamsBulkManifestSignature(tampered, publicKeyPem)).toBe(
			false,
		);
	});

	test("an unsigned manifest verifies false", () => {
		expect(verifyStreamsBulkManifestSignature(MANIFEST, publicKeyPem)).toBe(
			false,
		);
	});

	test("re-signing a signed manifest is idempotent in shape and verifies", () => {
		const once = signStreamsBulkManifest(MANIFEST, privateKeyPem);
		const twice = signStreamsBulkManifest(once, privateKeyPem);
		expect(canonicalStreamsBulkManifestPayload(twice)).toBe(
			JSON.stringify(MANIFEST),
		);
		expect(verifyStreamsBulkManifestSignature(twice, publicKeyPem)).toBe(true);
	});
});
