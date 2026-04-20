/**
 * Mint a short-lived service JWT for tenant API access.
 *
 * Used by `POST /api/tenants/me/keys/mint-ephemeral`. The session-authenticated
 * caller gets back a 5-minute token the CLI can use to hit its tenant directly,
 * so no long-lived service keys ever touch disk.
 *
 * The signer is inlined (duplicated from provisioner/src/jwt.ts) rather than
 * imported. The provisioner is a separate Docker image not bundled with the
 * platform API image — a direct import breaks at runtime.
 */

const TTL_SECONDS = 300;

export interface MintEphemeralInput {
	secret: string;
	slug: string;
	serviceGen: number;
}

export interface MintEphemeralOutput {
	serviceKey: string;
	expiresAt: string;
}

interface EphemeralJwtPayload {
	role: "service";
	sub: string;
	gen: number;
	iat: number;
	exp: number;
}

function base64UrlEncode(input: string | Uint8Array): string {
	const b64 =
		typeof input === "string"
			? Buffer.from(input).toString("base64")
			: Buffer.from(input).toString("base64");
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signHs256(
	payload: EphemeralJwtPayload,
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

export async function mintEphemeralServiceJwt(
	input: MintEphemeralInput,
): Promise<MintEphemeralOutput> {
	const now = Math.floor(Date.now() / 1000);
	const exp = now + TTL_SECONDS;
	const serviceKey = await signHs256(
		{
			role: "service",
			sub: input.slug,
			gen: input.serviceGen,
			iat: now,
			exp,
		},
		input.secret,
	);
	return {
		serviceKey,
		expiresAt: new Date(exp * 1000).toISOString(),
	};
}
