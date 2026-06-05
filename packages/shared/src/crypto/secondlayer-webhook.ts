import {
	ed25519KeyId,
	loadEd25519PrivateKey,
	loadEd25519PublicKey,
	publicKeyPemFromPrivate,
	signEd25519,
	verifyEd25519,
} from "./ed25519.ts";

/**
 * Universal Secondlayer webhook authenticity — an ed25519 signature attached to
 * EVERY delivery regardless of body format.
 *
 * Only the `standard-webhooks` format carries an HMAC; `raw`/`cloudevents`/etc.
 * carried no Secondlayer proof, so a receiver had no way to know a payload came
 * from us. This signs each delivery with a single platform ed25519 key so any
 * receiver verifies with the published public key — no per-subscription secret,
 * and the body shape stays format-specific.
 *
 * Header names are lowercase to match the format builders' header maps (HTTP
 * header names are case-insensitive on the wire).
 */
export const WEBHOOK_ID_HEADER = "webhook-id";
export const SECONDLAYER_SIGNATURE_HEADER = "x-secondlayer-signature";
export const SECONDLAYER_KEY_ID_HEADER = "x-secondlayer-signature-keyid";

export type SecondlayerWebhookSigner = {
	keyId: string;
	publicKeyPem: string;
	sign(payload: string): string;
};

let cached: SecondlayerWebhookSigner | null | undefined;

function signingKeyFromEnv(): string | undefined {
	// A dedicated webhook key if provided, else the platform Streams key — both
	// are the same ed25519 "single platform identity", so reusing it keeps key
	// distribution to one published public key.
	return (
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY ||
		process.env.STREAMS_SIGNING_PRIVATE_KEY ||
		undefined
	);
}

/**
 * Memoized webhook signer, or null when no key is configured (signing is then a
 * no-op, so the universal header is safe to ship before a key is provisioned).
 */
export function getSecondlayerWebhookSigner(): SecondlayerWebhookSigner | null {
	if (cached !== undefined) return cached;
	const raw = signingKeyFromEnv();
	if (!raw) {
		cached = null;
		return null;
	}
	// Env transport often escapes newlines; restore real PEM line breaks.
	const pem = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
	const privateKey = loadEd25519PrivateKey(pem);
	const publicKeyPem = publicKeyPemFromPrivate(pem);
	cached = {
		keyId: ed25519KeyId(publicKeyPem),
		publicKeyPem,
		sign: (payload) => signEd25519(payload, privateKey),
	};
	return cached;
}

/** Reset the memoized signer. Tests only. */
export function resetSecondlayerWebhookSignerForTest(): void {
	cached = undefined;
}

/**
 * The exact bytes the signature covers: `${webhookId}.${body}`. Binding the id
 * into the signed content stops a captured body from being replayed under a
 * different delivery id.
 */
function signedContent(webhookId: string, body: string): string {
	return `${webhookId}.${body}`;
}

/**
 * Build the universal authenticity headers for a delivery. Returns null when no
 * signing key is configured (caller leaves the delivery unsigned).
 */
export function signSecondlayerWebhook(
	webhookId: string,
	body: string,
): Record<string, string> | null {
	const signer = getSecondlayerWebhookSigner();
	if (!signer) return null;
	return {
		[WEBHOOK_ID_HEADER]: webhookId,
		[SECONDLAYER_SIGNATURE_HEADER]: signer.sign(signedContent(webhookId, body)),
		[SECONDLAYER_KEY_ID_HEADER]: signer.keyId,
	};
}

/**
 * Verify a delivery's ed25519 signature over `${webhookId}.${rawBody}` against
 * the published public key. Low-level (raw values); receivers use the SDK's
 * `verifySecondlayerSignature`, which extracts the headers ergonomically.
 */
export function verifySecondlayerSignatureValues(
	rawBody: string,
	webhookId: string | undefined,
	signatureBase64: string | undefined,
	publicKeyPem: string,
): boolean {
	if (!webhookId || !signatureBase64) return false;
	const publicKey = loadEd25519PublicKey(publicKeyPem);
	return verifyEd25519(
		signedContent(webhookId, rawBody),
		signatureBase64,
		publicKey,
	);
}
