import { describe, expect, test } from "bun:test";
import {
	generateTenantSecret,
	mintTenantKeys,
	signHs256Jwt,
} from "../src/jwt.ts";

describe("jwt", () => {
	test("generateTenantSecret produces 64 hex chars (256 bits)", () => {
		const secret = generateTenantSecret();
		expect(secret.length).toBe(64);
		expect(/^[0-9a-f]{64}$/.test(secret)).toBe(true);
	});

	test("generateTenantSecret produces unique secrets", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 100; i++) seen.add(generateTenantSecret());
		expect(seen.size).toBe(100);
	});

	test("signHs256Jwt produces 3-part token", async () => {
		const token = await signHs256Jwt(
			{ role: "anon", sub: "test0001", gen: 1, iat: 0 },
			"secret".repeat(8),
		);
		expect(token.split(".").length).toBe(3);
	});

	test("mintTenantKeys produces distinct anon + service tokens", async () => {
		const secret = generateTenantSecret();
		const { anonKey, serviceKey } = await mintTenantKeys("abc12345", secret, {
			serviceGen: 1,
			anonGen: 1,
		});
		expect(anonKey).not.toBe(serviceKey);
		// Both have 3 parts.
		expect(anonKey.split(".").length).toBe(3);
		expect(serviceKey.split(".").length).toBe(3);
	});

	test("mintTenantKeys tokens verify against auth-modes middleware logic", async () => {
		// Round-trip: mint here, verify with the same HS256 approach used by
		// packages/api/src/middleware/auth-modes.ts.
		const secret = generateTenantSecret();
		const { anonKey } = await mintTenantKeys("abc12345", secret, {
			serviceGen: 1,
			anonGen: 1,
		});

		const [headerB64, payloadB64, sigB64] = anonKey.split(".");
		const enc = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			enc.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);

		const sigBytes = base64UrlDecodeBytes(sigB64);
		const data = enc.encode(`${headerB64}.${payloadB64}`);
		const valid = await crypto.subtle.verify("HMAC", key, sigBytes, data);
		expect(valid).toBe(true);

		const payload = JSON.parse(base64UrlDecode(payloadB64));
		expect(payload.role).toBe("anon");
		expect(payload.sub).toBe("abc12345");
		expect(payload.gen).toBe(1);
	});

	test("mintTenantKeys embeds gen claim independently per role", async () => {
		const secret = generateTenantSecret();
		const { anonKey, serviceKey } = await mintTenantKeys("abc12345", secret, {
			serviceGen: 7,
			anonGen: 3,
		});
		const anonPayload = JSON.parse(base64UrlDecode(anonKey.split(".")[1]));
		const servicePayload = JSON.parse(
			base64UrlDecode(serviceKey.split(".")[1]),
		);
		expect(anonPayload.gen).toBe(3);
		expect(servicePayload.gen).toBe(7);
	});
});

function base64UrlDecode(input: string): string {
	const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	return atob(padded);
}

function base64UrlDecodeBytes(input: string): Uint8Array {
	const binary = base64UrlDecode(input);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
