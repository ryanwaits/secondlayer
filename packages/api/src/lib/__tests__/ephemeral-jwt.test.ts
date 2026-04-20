import { describe, expect, test } from "bun:test";
import { mintEphemeralServiceJwt } from "../ephemeral-jwt.ts";

const SECRET = "0".repeat(64);

describe("mintEphemeralServiceJwt", () => {
	test("embeds role=service, sub, gen, iat, exp (5min)", async () => {
		const { serviceKey, expiresAt } = await mintEphemeralServiceJwt({
			secret: SECRET,
			slug: "abc12345",
			serviceGen: 3,
		});
		const parts = serviceKey.split(".");
		expect(parts.length).toBe(3);
		const payload = JSON.parse(base64UrlDecode(parts[1]));
		expect(payload.role).toBe("service");
		expect(payload.sub).toBe("abc12345");
		expect(payload.gen).toBe(3);
		expect(payload.exp - payload.iat).toBe(300);
		// expiresAt mirrors exp within 5s (wall clock).
		const expiresAtSec = Math.floor(new Date(expiresAt).getTime() / 1000);
		expect(Math.abs(expiresAtSec - payload.exp)).toBeLessThan(5);
	});

	test("signature verifies against the same secret", async () => {
		const { serviceKey } = await mintEphemeralServiceJwt({
			secret: SECRET,
			slug: "abc12345",
			serviceGen: 1,
		});
		const [h, p, s] = serviceKey.split(".");
		const enc = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			enc.encode(SECRET),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		);
		const sigBytes = base64UrlDecodeBytes(s);
		const data = enc.encode(`${h}.${p}`);
		const valid = await crypto.subtle.verify("HMAC", key, sigBytes, data);
		expect(valid).toBe(true);
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
