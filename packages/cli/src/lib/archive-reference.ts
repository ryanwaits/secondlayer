import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	type KeyRegistry,
	checkKeyTrust,
	publicKeyFor,
	verifyRegistry,
} from "@secondlayer/shared/archive/key-registry";
import type { RangeDigest } from "@secondlayer/shared/archive/range-digest";
import type { PartitionSemanticDigest } from "@secondlayer/shared/archive/semantic-digest";
import { verifyStreamsBulkManifestSignature } from "@secondlayer/shared/streams-bulk-manifest";

/**
 * Loading and trusting an archive reference — shared by `secondlayer verify` and
 * `secondlayer repair` so the two can never disagree about what "the archive says".
 *
 * A reference is either an https URL or a local path to a snapshot manifest.
 * Partition objects live beside it at `<root>/<dataset>/<name>.parquet`, where
 * the root is two levels above the manifest (`<root>/snapshots/<digest>.json`).
 */

export type ArchivePartition = {
	dataset: string;
	from_block: number;
	to_block: number;
	path: string;
	row_count: number;
	byte_size: number;
	sha256: string;
};

export type ArchiveManifest = {
	network?: string;
	coverage?: { from_block: number; to_block: number };
	partition_size_blocks?: number;
	range_digests?: RangeDigest[];
	partition_semantic_digests?: PartitionSemanticDigest[];
	partitions?: ArchivePartition[];
	signature?: string;
	key_id?: string;
	[key: string]: unknown;
};

export type LoadedReference = {
	manifest: ArchiveManifest;
	origin: string;
	/** Base for resolving partition paths; a URL prefix or a directory. */
	root: string;
	isRemote: boolean;
};

/**
 * The archive root, `latest.json`, is a signed POINTER at a snapshot manifest,
 * not a manifest itself. It is also the only URL a user can be expected to
 * know, so every command accepts it and follows it — anything else makes the
 * obvious command fail with an error about digests, which reads as "this tool
 * is broken" rather than "you passed the wrong file".
 */
type LatestPointer = {
	snapshot_path?: string;
	snapshot_digest?: string;
};

function isLatestPointer(value: ArchiveManifest): boolean {
	const pointer = value as LatestPointer;
	return (
		typeof pointer.snapshot_path === "string" &&
		(value.partitions === undefined || value.partitions.length === 0)
	);
}

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!response.ok) {
		throw new Error(
			`could not fetch manifest (${response.status} ${response.statusText})`,
		);
	}
	return response.json();
}

export async function loadReference(source: string): Promise<LoadedReference> {
	const isRemote = /^https?:\/\//.test(source);
	let manifest: ArchiveManifest;
	let root: string;

	if (isRemote) {
		manifest = (await fetchJson(source)) as ArchiveManifest;
		const url = new URL(source);
		// Both `<root>/latest.json` and `<root>/snapshots/<digest>.json` resolve
		// their partition paths against `<root>`.
		url.pathname = url.pathname
			.replace(/\/snapshots\/[^/]+$/, "")
			.replace(/\/[^/]+\.json$/, "");
		root = url.toString();
	} else {
		const path = resolve(source);
		manifest = JSON.parse(await readFile(path, "utf8")) as ArchiveManifest;
		root = isLatestPointer(manifest) ? dirname(path) : dirname(dirname(path));
	}

	if (!isLatestPointer(manifest)) {
		return { manifest, origin: source, root, isRemote };
	}

	// Follow the pointer, then prove it led where it claimed. A tampered
	// pointer could otherwise redirect to a different — and still validly
	// signed — snapshot, which is a downgrade attack rather than a forgery.
	const pointer = manifest as ArchiveManifest & LatestPointer;
	const snapshotPath = pointer.snapshot_path as string;
	const resolved = isRemote
		? ((await fetchJson(
				`${root.replace(/\/$/, "")}/${snapshotPath}`,
			)) as ArchiveManifest)
		: (JSON.parse(
				await readFile(join(root, snapshotPath), "utf8"),
			) as ArchiveManifest);

	if (pointer.snapshot_digest) {
		const digest = createHash("sha256")
			.update(
				JSON.stringify(
					(({ signature: _s, key_id: _k, ...rest }) => rest)(
						resolved as Record<string, unknown>,
					),
				),
			)
			.digest("hex");
		if (digest !== pointer.snapshot_digest) {
			throw new Error(
				`pointer/snapshot mismatch: latest.json names ${pointer.snapshot_digest}, resolved manifest hashes to ${digest}`,
			);
		}
	}

	return { manifest: resolved, origin: source, root, isRemote };
}

export type SignatureResult = { verified: boolean; reason?: string };

/**
 * An unsigned or unverifiable reference is worthless as a source of truth:
 * comparing against it yields a confident answer with nothing behind it, and
 * repairing from it would write unverified data into a live database.
 */
export function checkSignature(
	manifest: ArchiveManifest,
	publicKeyPem: string | undefined,
	insecure: boolean,
): SignatureResult {
	if (insecure) return { verified: false, reason: "signature check skipped" };
	if (!manifest.signature) {
		return { verified: false, reason: "manifest carries no signature" };
	}
	if (!publicKeyPem) {
		return {
			verified: false,
			reason: "no public key available to verify with",
		};
	}
	try {
		const verified = verifyStreamsBulkManifestSignature(
			manifest as Record<string, unknown>,
			publicKeyPem,
		);
		return {
			verified,
			reason: verified ? undefined : "signature did not verify",
		};
	} catch (err) {
		return {
			verified: false,
			reason: err instanceof Error ? err.message : "signature check failed",
		};
	}
}

const HOSTED_API = "https://api.secondlayer.tools";

export function isHostedApiUrl(url: string): boolean {
	try {
		return new URL(url).hostname === "api.secondlayer.tools";
	} catch {
		return false;
	}
}

export async function resolvePublicKey(
	explicitPem: string | undefined,
	apiUrl: string,
): Promise<string | undefined> {
	if (explicitPem) return explicitPem;
	try {
		const response = await fetch(
			`${apiUrl.replace(/\/$/, "")}/public/streams/signing-key`,
			{ signal: AbortSignal.timeout(10_000) },
		);
		if (!response.ok) return undefined;
		const body = (await response.json()) as { public_key_pem?: string };
		return body.public_key_pem;
	} catch {
		// Offline is a legitimate state, reported as `unanchored` by the caller.
		return undefined;
	}
}

/**
 * Archive verify key. OSS never fetches api.secondlayer.tools — pin
 * `--public-key` or ARCHIVE_SIGNING_PUBLIC_KEY after the first verify.
 */
export async function resolveArchivePublicKey(input: {
	explicitPem?: string;
	envPem?: string;
	allowHostedApi?: boolean;
}): Promise<string | undefined> {
	if (input.explicitPem) return input.explicitPem;
	if (input.envPem) return input.envPem;
	if (input.allowHostedApi) {
		return resolvePublicKey(undefined, HOSTED_API);
	}
	return undefined;
}

/**
 * Resolve a manifest's signing key through the archive's root-signed key
 * registry, when one is published.
 *
 * This is stronger than fetching a bare signing key over HTTPS: that only
 * proves whoever serves the endpoint chose the key. The registry is signed by
 * an offline root, so a compromised publishing host cannot nominate its own
 * signer, and a leaked key can be marked compromised without waiting for
 * consumers to update.
 *
 * Returns null when no registry is published, so callers fall back to the
 * existing behaviour rather than hard-failing an archive that predates it.
 */
export async function resolveKeyThroughRegistry(params: {
	root: string;
	isRemote: boolean;
	keyId: string | undefined;
	signedAt: string | undefined;
	rootPublicKeyPem: string | undefined;
}): Promise<{ publicKeyPem: string; trusted: true } | SignatureResult | null> {
	if (!params.keyId || !params.rootPublicKeyPem) return null;
	let registry: KeyRegistry;
	try {
		if (params.isRemote) {
			const response = await fetch(
				`${params.root.replace(/\/$/, "")}/keys/registry.json`,
				{ signal: AbortSignal.timeout(10_000) },
			);
			if (!response.ok) return null;
			registry = (await response.json()) as KeyRegistry;
		} else {
			registry = JSON.parse(
				await readFile(join(params.root, "keys", "registry.json"), "utf8"),
			) as KeyRegistry;
		}
	} catch {
		// No registry published (or unreachable) — not an error yet.
		return null;
	}

	const rootCheck = verifyRegistry(registry, params.rootPublicKeyPem);
	if (!rootCheck.trusted) {
		return { verified: false, reason: rootCheck.detail };
	}
	const trust = checkKeyTrust(
		registry,
		params.keyId,
		params.signedAt ?? new Date().toISOString(),
	);
	if (!trust.trusted) {
		return { verified: false, reason: trust.detail };
	}
	const pem = publicKeyFor(registry, params.keyId);
	if (!pem) {
		return { verified: false, reason: `key ${params.keyId} has no public key` };
	}
	return { publicKeyPem: pem, trusted: true };
}

/**
 * Fetch a partition and refuse it unless its bytes hash to the digest the
 * signed manifest declares. This is the step that makes repair safe: data only
 * enters a live database after proving it is the data the archive signed.
 */
export async function fetchVerifiedPartition(
	reference: LoadedReference,
	partition: ArchivePartition,
): Promise<Buffer> {
	let bytes: Buffer;
	if (reference.isRemote) {
		const url = `${reference.root.replace(/\/$/, "")}/${partition.path}`;
		const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
		if (!response.ok) {
			throw new Error(
				`could not fetch ${partition.path} (${response.status} ${response.statusText})`,
			);
		}
		bytes = Buffer.from(await response.arrayBuffer());
	} else {
		bytes = await readFile(join(reference.root, partition.path));
	}

	const digest = createHash("sha256").update(bytes).digest("hex");
	if (digest !== partition.sha256) {
		throw new Error(
			`${partition.path} failed verification: expected ${partition.sha256}, got ${digest}`,
		);
	}
	return bytes;
}
