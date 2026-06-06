import {
	ed25519KeyId,
	loadEd25519PrivateKey,
	loadEd25519PublicKey,
	publicKeyPemFromPrivate,
	signEd25519,
	verifyEd25519,
} from "./crypto/ed25519.ts";

/**
 * ed25519 signing for the Streams cold-bulk parquet manifest.
 *
 * The live Streams lane is ed25519-signed; the bulk manifest was plain JSON with
 * only per-file sha256, so a tampered manifest+file pair verified cleanly. This
 * signs the manifest itself with the same platform key, so a consumer can trust
 * the file hashes only after the manifest signature checks out — making the two
 * availability lanes symmetric.
 *
 * The signed bytes are the manifest's canonical JSON with the signature envelope
 * fields removed, so signer and verifier agree without a separate canonical
 * form: `signature`/`key_id` are appended last, so stripping them and
 * re-serializing reproduces the exact pre-sign bytes.
 */
type SignatureEnvelope = { signature?: string; key_id?: string };

/** The exact bytes a manifest signature covers: the manifest JSON minus the
 *  signature envelope fields. */
export function canonicalStreamsBulkManifestPayload(
	manifest: Record<string, unknown> & SignatureEnvelope,
): string {
	const { signature: _signature, key_id: _keyId, ...rest } = manifest;
	return JSON.stringify(rest);
}

function normalizePem(pem: string): string {
	// Env transport often escapes newlines; restore real PEM line breaks.
	return pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
}

/**
 * Attach an ed25519 `signature` + `key_id` over the manifest's canonical bytes.
 * Returns a new manifest; re-signing one that already carries a signature signs
 * over its un-enveloped form (idempotent shape).
 */
export function signStreamsBulkManifest<
	T extends Record<string, unknown> & SignatureEnvelope,
>(
	manifest: T,
	privateKeyPem: string,
): T & { signature: string; key_id: string } {
	const pem = normalizePem(privateKeyPem);
	const privateKey = loadEd25519PrivateKey(pem);
	const keyId = ed25519KeyId(publicKeyPemFromPrivate(pem));
	const { signature: _signature, key_id: _keyId, ...base } = manifest;
	const payload = JSON.stringify(base);
	return {
		...(base as T),
		signature: signEd25519(payload, privateKey),
		key_id: keyId,
	};
}

/** Verify a manifest's ed25519 signature against the published public key. */
export function verifyStreamsBulkManifestSignature(
	manifest: Record<string, unknown> & SignatureEnvelope,
	publicKeyPem: string,
): boolean {
	if (!manifest.signature) return false;
	const payload = canonicalStreamsBulkManifestPayload(manifest);
	return verifyEd25519(
		payload,
		manifest.signature,
		loadEd25519PublicKey(publicKeyPem),
	);
}
