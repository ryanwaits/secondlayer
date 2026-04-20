/**
 * Mint a short-lived service JWT for tenant API access.
 *
 * Used by `POST /api/tenants/me/keys/mint-ephemeral`. The session-authenticated
 * caller gets back a 5-minute token the CLI can use to hit its tenant directly,
 * so no long-lived service keys ever touch disk.
 *
 * Reuses the same HS256 signer as the provision-time keys so tenant API
 * validation (which checks signature + `gen` claim against its env vars)
 * doesn't need a separate code path.
 */

import { signHs256Jwt } from "@secondlayer/provisioner/src/jwt";

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

export async function mintEphemeralServiceJwt(
	input: MintEphemeralInput,
): Promise<MintEphemeralOutput> {
	const now = Math.floor(Date.now() / 1000);
	const exp = now + TTL_SECONDS;
	const serviceKey = await signHs256Jwt(
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
