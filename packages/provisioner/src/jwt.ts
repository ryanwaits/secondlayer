/**
 * Mint HS256 JWTs for tenant anon/service roles.
 *
 * Verification happens in `packages/api/src/middleware/auth-modes.ts` —
 * keep the payload shape in sync with `TenantJwtPayload` there.
 *
 * The `gen` claim carries the role's current generation counter. The
 * tenant API reads `SERVICE_GEN` + `ANON_GEN` from its env at startup
 * and rejects JWTs whose `gen` doesn't match. Bumping a gen counter +
 * recreating the API container invalidates all prior JWTs of that role.
 */

import { randomBytes } from "node:crypto";

export type TenantRole = "anon" | "service";

interface TenantJwtPayload {
	role: TenantRole;
	sub: string;
	gen: number;
	iat: number;
	exp?: number;
}

function base64UrlEncode(input: string | Uint8Array): string {
	const b64 =
		typeof input === "string"
			? Buffer.from(input).toString("base64")
			: Buffer.from(input).toString("base64");
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signHs256Jwt(
	payload: TenantJwtPayload,
	secret: string,
): Promise<string> {
	const header = { alg: "HS256", typ: "JWT" };
	const encodedHeader = base64UrlEncode(JSON.stringify(header));
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const data = `${encodedHeader}.${encodedPayload}`;

	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sigBytes = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, enc.encode(data)),
	);
	const sig = base64UrlEncode(sigBytes);
	return `${data}.${sig}`;
}

export function generateTenantSecret(): string {
	// 32 bytes → 64 hex chars → 256 bits of entropy. HS256 requires ≥256 bits.
	return randomBytes(32).toString("hex");
}

export async function mintTenantKeys(
	slug: string,
	secret: string,
	gens: { serviceGen: number; anonGen: number },
): Promise<{ anonKey: string; serviceKey: string }> {
	const now = Math.floor(Date.now() / 1000);
	const anonKey = await signHs256Jwt(
		{ role: "anon", sub: slug, gen: gens.anonGen, iat: now },
		secret,
	);
	const serviceKey = await signHs256Jwt(
		{ role: "service", sub: slug, gen: gens.serviceGen, iat: now },
		secret,
	);
	return { anonKey, serviceKey };
}

export async function mintSingleKey(
	slug: string,
	secret: string,
	role: TenantRole,
	gen: number,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return signHs256Jwt({ role, sub: slug, gen, iat: now }, secret);
}
