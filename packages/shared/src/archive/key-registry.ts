import {
	ed25519KeyId,
	loadEd25519PublicKey,
	verifyEd25519,
} from "../crypto/ed25519.ts";

/**
 * Trust root for the canonical archive.
 *
 * Day-to-day signing uses an ONLINE key that lives on the publishing host, so
 * it is exposed to every risk that host is. The archive's actual trust anchor
 * is an OFFLINE ROOT key that never touches a server: it signs a registry of
 * online keys, and nothing else. A consumer pins the root public key, verifies
 * the registry against it, and only then decides whether a manifest's signature
 * means anything.
 *
 * The distinction that makes rotation survivable:
 *
 *   retired / rotated → the key stops signing NEW objects, but everything it
 *                       signed while valid stays valid. Without this, every
 *                       rotation would invalidate the entire published history.
 *   compromised       → every signature by that key is suspect, including
 *                       historical ones, because an attacker holding the key
 *                       could have backdated anything.
 *
 * Those two cases look identical in a naive "is this key current?" check, and
 * conflating them either destroys your history on every rotation or accepts
 * forgeries after a leak.
 */

export const KEY_REGISTRY_SCHEMA_VERSION = 1;

export type KeyStatus = "active" | "retired" | "compromised";

export type RegisteredKey = {
	key_id: string;
	public_key_pem: string;
	status: KeyStatus;
	/** ISO timestamp this key became valid for signing. */
	valid_from: string;
	/** ISO timestamp it stopped signing. Null while active. */
	valid_until: string | null;
	/** For `compromised`: the moment trust is withdrawn. Everything this key
	 *  signed is suspect regardless of when, so this is provenance, not a
	 *  validity bound. */
	compromised_at?: string;
};

export type KeyRegistry = {
	schema_version: typeof KEY_REGISTRY_SCHEMA_VERSION;
	network: string;
	keys: RegisteredKey[];
	updated_at: string;
	/** Root signature over the registry minus this envelope. */
	signature?: string;
	root_key_id?: string;
};

export type KeyTrustResult = {
	trusted: boolean;
	/** Machine-readable so callers can map to exit codes and messages. */
	reason:
		| "trusted"
		| "registry-unsigned"
		| "registry-signature-invalid"
		| "unknown-key"
		| "key-compromised"
		| "signed-outside-validity";
	detail: string;
};

/** The exact bytes the root signature covers: the registry minus its envelope. */
export function canonicalRegistryPayload(registry: KeyRegistry): string {
	const { signature: _s, root_key_id: _r, ...rest } = registry;
	return JSON.stringify(rest);
}

/**
 * Verify the registry itself against the pinned root public key. Everything
 * downstream is meaningless if this fails — an attacker who can serve a
 * registry can otherwise nominate their own signing key.
 */
export function verifyRegistry(
	registry: KeyRegistry,
	rootPublicKeyPem: string,
): KeyTrustResult {
	if (!registry.signature) {
		return {
			trusted: false,
			reason: "registry-unsigned",
			detail: "key registry carries no root signature",
		};
	}
	let valid = false;
	try {
		valid = verifyEd25519(
			canonicalRegistryPayload(registry),
			registry.signature,
			loadEd25519PublicKey(rootPublicKeyPem),
		);
	} catch (err) {
		return {
			trusted: false,
			reason: "registry-signature-invalid",
			detail: err instanceof Error ? err.message : "root verification failed",
		};
	}
	return valid
		? {
				trusted: true,
				reason: "trusted",
				detail: "registry verified against root",
			}
		: {
				trusted: false,
				reason: "registry-signature-invalid",
				detail: "registry signature does not match the pinned root key",
			};
}

/**
 * Decide whether an object signed by `keyId` at `signedAt` should be trusted.
 *
 * `signedAt` is the object's own generation time, NOT now — that is what lets a
 * rotated key keep vouching for what it signed while it was valid.
 */
export function checkKeyTrust(
	registry: KeyRegistry,
	keyId: string,
	signedAt: string,
): KeyTrustResult {
	const key = registry.keys.find((k) => k.key_id === keyId);
	if (!key) {
		return {
			trusted: false,
			reason: "unknown-key",
			detail: `key ${keyId} is not in the registry`,
		};
	}
	if (key.status === "compromised") {
		return {
			trusted: false,
			reason: "key-compromised",
			detail: `key ${keyId} was compromised${key.compromised_at ? ` (${key.compromised_at})` : ""}; every signature it made is suspect`,
		};
	}

	const signedTime = Date.parse(signedAt);
	const from = Date.parse(key.valid_from);
	if (Number.isNaN(signedTime) || Number.isNaN(from)) {
		return {
			trusted: false,
			reason: "signed-outside-validity",
			detail: "unparseable timestamp on the object or the key",
		};
	}
	if (signedTime < from) {
		return {
			trusted: false,
			reason: "signed-outside-validity",
			detail: `object predates key validity (${signedAt} < ${key.valid_from})`,
		};
	}
	if (key.valid_until !== null) {
		const until = Date.parse(key.valid_until);
		if (!Number.isNaN(until) && signedTime > until) {
			return {
				trusted: false,
				reason: "signed-outside-validity",
				detail: `object postdates key retirement (${signedAt} > ${key.valid_until})`,
			};
		}
	}

	// A retired key that was valid at signing time is fine — that is the whole
	// point of recording a validity window rather than a boolean.
	return {
		trusted: true,
		reason: "trusted",
		detail:
			key.status === "active"
				? `signed by active key ${keyId}`
				: `signed by ${keyId} while it was valid (now ${key.status})`,
	};
}

/** Look up a key's public PEM for signature verification. */
export function publicKeyFor(
	registry: KeyRegistry,
	keyId: string,
): string | undefined {
	return registry.keys.find((k) => k.key_id === keyId)?.public_key_pem;
}

/** Derive the registry entry id for a public key, so operators cannot mislabel
 *  a key by hand-editing the registry. */
export function keyIdFor(publicKeyPem: string): string {
	return ed25519KeyId(publicKeyPem);
}
