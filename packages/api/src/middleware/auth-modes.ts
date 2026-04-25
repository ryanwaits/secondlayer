import {
	AuthenticationError,
	AuthorizationError,
	KeyRotatedError,
} from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";

/**
 * Auth middleware factories for each instance mode.
 *
 * - `noAuth()` — OSS default. Pass-through; no auth context set.
 * - `staticKeyAuth(key)` — OSS with a shared Bearer key. Pass-through when the
 *   `API_KEY` env var is unset; otherwise requires `Authorization: Bearer $API_KEY`.
 * - `dedicatedAuth()` — Dedicated tenant mode. Verifies JWT signed with
 *   `TENANT_JWT_SECRET`; extracts `role: "anon" | "service"` from the payload.
 *   `anon` = read-only (GET only); `service` = full access.
 *
 * Platform mode uses `requireAuth()` from `packages/api/src/auth` directly — see
 * `packages/api/src/index.ts` mounting logic.
 */

/** Pass-through middleware — used in OSS mode when no key is configured. */
export function noAuth(): MiddlewareHandler {
	return async (_c, next) => {
		await next();
	};
}

/**
 * Simple shared-key auth for OSS instances that want a password gate.
 * When `API_KEY` is unset or empty, behaves like `noAuth()`.
 */
export function staticKeyAuth(): MiddlewareHandler {
	return async (c, next) => {
		const expected = process.env.API_KEY?.trim();
		if (!expected) {
			// No key configured → pass through (same as noAuth).
			await next();
			return;
		}
		const auth = c.req.header("authorization");
		if (!auth?.startsWith("Bearer ")) {
			throw new AuthenticationError("Missing or invalid Authorization header");
		}
		const provided = auth.slice(7);
		if (provided !== expected) {
			throw new AuthenticationError("Invalid API key");
		}
		await next();
	};
}

interface TenantJwtPayload {
	role: "anon" | "service";
	sub?: string;
	gen?: number;
	exp?: number;
	iat?: number;
}

type TenantRole = TenantJwtPayload["role"];

/**
 * Dedicated-mode auth. Requires JWT signed with `TENANT_JWT_SECRET` using
 * HS256. Sets `c.var.tenantRole` to `"anon"` or `"service"`. Anon keys are
 * allowed for GET requests only; non-GET requires `service`.
 *
 * The `gen` claim is matched against `SERVICE_GEN` / `ANON_GEN` env vars,
 * which the provisioner bumps on key rotation and injects at container
 * create time. Mismatched gen = token issued before the last rotation =
 * 401. Missing `gen` claim is treated as gen=1 (pre-rotation grandfathered
 * tokens; no prior version of this API shipped `gen` so there's no legacy
 * to break).
 */
export function dedicatedAuth(): MiddlewareHandler {
	return async (c, next) => {
		const secret = process.env.TENANT_JWT_SECRET;
		if (!secret) {
			throw new Error(
				"TENANT_JWT_SECRET env var is required in dedicated mode",
			);
		}
		const serviceGen = Number.parseInt(process.env.SERVICE_GEN ?? "1", 10);
		const anonGen = Number.parseInt(process.env.ANON_GEN ?? "1", 10);

		const auth = c.req.header("authorization");
		if (!auth?.startsWith("Bearer ")) {
			throw new AuthenticationError("Missing or invalid Authorization header");
		}
		const token = auth.slice(7);

		let payload: TenantJwtPayload;
		try {
			payload = await verifyHs256Jwt<TenantJwtPayload>(token, secret);
		} catch (err) {
			throw new AuthenticationError(
				err instanceof Error ? err.message : "Invalid token",
			);
		}

		if (payload.exp && Date.now() / 1000 > payload.exp) {
			throw new AuthenticationError("Token has expired");
		}

		if (payload.role !== "anon" && payload.role !== "service") {
			throw new AuthenticationError("Invalid role claim");
		}

		const expectedGen = payload.role === "service" ? serviceGen : anonGen;
		const tokenGen = payload.gen ?? 1;
		if (tokenGen !== expectedGen) {
			throw new KeyRotatedError();
		}

		// Anon keys are read-only; gate non-GET methods.
		if (payload.role === "anon" && c.req.method !== "GET") {
			throw new AuthorizationError("anon key is read-only");
		}

		c.set("tenantRole", payload.role as TenantRole);
		await next();
	};
}

/**
 * Minimal HS256 JWT verification. Avoids pulling a JWT dependency — we only
 * need to verify tokens we mint ourselves from the control plane.
 */
async function verifyHs256Jwt<T>(token: string, secret: string): Promise<T> {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("Malformed JWT");
	const [headerB64, payloadB64, sigB64] = parts;

	const header = JSON.parse(base64UrlDecode(headerB64));
	if (header.alg !== "HS256" || header.typ !== "JWT") {
		throw new Error("Unsupported JWT algorithm");
	}

	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const sig = base64UrlDecodeBytes(sigB64);
	const data = enc.encode(`${headerB64}.${payloadB64}`);
	const valid = await crypto.subtle.verify("HMAC", key, sig, data);
	if (!valid) throw new Error("Invalid signature");

	return JSON.parse(base64UrlDecode(payloadB64)) as T;
}

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
