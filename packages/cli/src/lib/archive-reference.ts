import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { RangeDigest } from "@secondlayer/shared/archive/range-digest";
import { verifyStreamsBulkManifestSignature } from "@secondlayer/shared/streams-bulk-manifest";

/**
 * Loading and trusting an archive reference — shared by `sl verify` and
 * `sl repair` so the two can never disagree about what "the archive says".
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

export async function loadReference(source: string): Promise<LoadedReference> {
	if (/^https?:\/\//.test(source)) {
		const response = await fetch(source, {
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			throw new Error(
				`could not fetch manifest (${response.status} ${response.statusText})`,
			);
		}
		const url = new URL(source);
		// .../<root>/snapshots/<digest>.json → .../<root>
		url.pathname = url.pathname.replace(/\/snapshots\/[^/]+$/, "");
		return {
			manifest: (await response.json()) as ArchiveManifest,
			origin: source,
			root: url.toString(),
			isRemote: true,
		};
	}
	const path = resolve(source);
	const raw = await readFile(path, "utf8");
	return {
		manifest: JSON.parse(raw) as ArchiveManifest,
		origin: path,
		root: dirname(dirname(path)),
		isRemote: false,
	};
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
