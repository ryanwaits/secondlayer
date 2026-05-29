import {
	type KeyObject,
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	sign as nodeSign,
	verify as nodeVerify,
} from "node:crypto";

/**
 * Asymmetric ed25519 signing for Streams response proofs.
 *
 * Asymmetric (not HMAC) so the proof is real: only the server holds the private
 * key, and any consumer verifies with the published public key — no shared
 * secret to leak. ed25519 uses node's `sign`/`verify` with a `null` algorithm.
 * Keys are PEM (PKCS8 private / SPKI public) for env transport; load once and
 * reuse the KeyObject on hot paths.
 */

export function generateEd25519KeyPair(): {
	privateKeyPem: string;
	publicKeyPem: string;
} {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	return {
		privateKeyPem: privateKey
			.export({ format: "pem", type: "pkcs8" })
			.toString(),
		publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
	};
}

export function loadEd25519PrivateKey(pem: string): KeyObject {
	return createPrivateKey(pem);
}

export function loadEd25519PublicKey(pem: string): KeyObject {
	return createPublicKey(pem);
}

export function publicKeyPemFromPrivate(privateKeyPem: string): string {
	return createPublicKey(createPrivateKey(privateKeyPem))
		.export({ format: "pem", type: "spki" })
		.toString();
}

/** Stable short id for a public key (rotation hint via X-Signature-KeyId). */
export function ed25519KeyId(publicKeyPem: string): string {
	const der = createPublicKey(publicKeyPem).export({
		format: "der",
		type: "spki",
	});
	return createHash("sha256").update(der).digest("base64url").slice(0, 16);
}

export function signEd25519(payload: string, privateKey: KeyObject): string {
	return nodeSign(null, Buffer.from(payload, "utf8"), privateKey).toString(
		"base64",
	);
}

export function verifyEd25519(
	payload: string,
	signatureBase64: string,
	publicKey: KeyObject,
): boolean {
	try {
		return nodeVerify(
			null,
			Buffer.from(payload, "utf8"),
			publicKey,
			Buffer.from(signatureBase64, "base64"),
		);
	} catch {
		return false;
	}
}
