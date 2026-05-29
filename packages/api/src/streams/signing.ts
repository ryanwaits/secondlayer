import { ed25519 } from "@secondlayer/shared";
import type { Context } from "hono";

/**
 * ed25519 signing of Streams responses.
 *
 * When `STREAMS_SIGNING_PRIVATE_KEY` is set, every signed response carries an
 * `X-Signature` (base64 ed25519 over the exact response bytes) and an
 * `X-Signature-KeyId`. Consumers verify with the published public key
 * (`GET /public/streams/signing-key`) — no shared secret. Signing is disabled
 * (no headers) when the key is unset, so it is safe to ship before the key is
 * provisioned.
 */
export type StreamsSigner = {
	keyId: string;
	publicKeyPem: string;
	sign(body: string): string;
};

let cached: StreamsSigner | null | undefined;

export function getStreamsSigner(): StreamsSigner | null {
	if (cached !== undefined) return cached;
	const raw = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	if (!raw) {
		cached = null;
		return null;
	}
	// Env transport often escapes newlines; restore real PEM line breaks.
	const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
	const privateKey = ed25519.loadEd25519PrivateKey(pem);
	const publicKeyPem = ed25519.publicKeyPemFromPrivate(pem);
	cached = {
		keyId: ed25519.ed25519KeyId(publicKeyPem),
		publicKeyPem,
		sign: (body) => ed25519.signEd25519(body, privateKey),
	};
	return cached;
}

/** Reset the memoized signer. Tests only. */
export function resetStreamsSignerForTest(): void {
	cached = undefined;
}

/**
 * Serialize `payload`, attach signature headers when signing is enabled, and
 * return the response over the exact bytes that were signed (so a verifier can
 * check the raw body it received).
 */
export function respondSignedJson(c: Context, payload: unknown): Response {
	const body = JSON.stringify(payload);
	const signer = getStreamsSigner();
	if (signer) {
		c.header("X-Signature", signer.sign(body));
		c.header("X-Signature-KeyId", signer.keyId);
	}
	c.header("Content-Type", "application/json; charset=utf-8");
	return c.body(body);
}
