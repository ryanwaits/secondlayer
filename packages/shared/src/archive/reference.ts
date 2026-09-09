import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { verifyStreamsBulkManifestSignature } from "../streams-bulk-manifest.ts";
import type { RangeDigest } from "./range-digest.ts";
import { ARCHIVE_ROOT_PUBLIC_KEY_PEM } from "./root-key.ts";
import type { PartitionSemanticDigest } from "./semantic-digest.ts";

/**
 * Loading and trusting an archive reference — shared by the CLI and the SDK
 * so the two cannot disagree about what "the archive says".
 *
 * A reference is either an https URL or a local path to a snapshot manifest.
 * The SDK only passes `http(s)://` sources; local paths stay CLI. Partition
 * objects live beside the snapshot at `<root>/<dataset>/<name>.parquet`,
 * where the root is two levels above the manifest
 * (`<root>/snapshots/<digest>.json`).
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
	signature?: string;
	key_id?: string;
};

function isLatestPointer(value: ArchiveManifest): boolean {
	const pointer = value as LatestPointer;
	return (
		typeof pointer.snapshot_path === "string" &&
		(value.partitions === undefined || value.partitions.length === 0)
	);
}

/** The publisher names snapshots by their content digest and nothing else
 *  (`packages/indexer/src/archive/promote-snapshot.ts`). Anything looser is
 *  a pointer someone rewrote, and it must not steer a fetch. */
const SNAPSHOT_PATH_PATTERN = /^snapshots\/[0-9a-f]{64}\.json$/;

async function fetchJson(
	url: string,
	fetchImpl: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>,
): Promise<unknown> {
	const response = await fetchImpl(url, {
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) {
		throw new Error(
			`could not fetch manifest (${response.status} ${response.statusText})`,
		);
	}
	return response.json();
}

export type LoadReferenceOptions = {
	/** Key used to verify a signed `latest.json` pointer. The pointer names
	 *  which snapshot is current, so without this an attacker holding only
	 *  bucket write access could roll every reader back to an older, still
	 *  validly signed, snapshot. */
	publicKeyPem?: string;
	/** Test/SDK seam; production CLI leaves this unset and uses global fetch. */
	fetchImpl?: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>;
};

export async function loadReference(
	source: string,
	options: LoadReferenceOptions = {},
): Promise<LoadedReference> {
	const isRemote = /^https?:\/\//.test(source);
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	let manifest: ArchiveManifest;
	let root: string;

	if (isRemote) {
		manifest = (await fetchJson(source, fetchImpl)) as ArchiveManifest;
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
	if (!SNAPSHOT_PATH_PATTERN.test(snapshotPath)) {
		throw new Error(
			`pointer names an invalid snapshot path: ${snapshotPath} (expected snapshots/<sha256>.json)`,
		);
	}
	if (
		typeof pointer.snapshot_digest !== "string" ||
		!/^[0-9a-f]{64}$/.test(pointer.snapshot_digest)
	) {
		throw new Error(
			"pointer carries no snapshot_digest, so it cannot prove which snapshot is current",
		);
	}
	if (pointer.signature !== undefined) {
		if (!options.publicKeyPem) {
			throw new Error(
				"pointer is signed but no public key is available to verify it",
			);
		}
		let verified = false;
		try {
			verified = verifyStreamsBulkManifestSignature(
				pointer as Record<string, unknown>,
				options.publicKeyPem,
			);
		} catch {
			verified = false;
		}
		if (!verified) {
			throw new Error(
				"pointer signature did not verify against the archive key",
			);
		}
	}

	const resolved = isRemote
		? ((await fetchJson(
				`${root.replace(/\/$/, "")}/${snapshotPath}`,
				fetchImpl,
			)) as ArchiveManifest)
		: (JSON.parse(
				await readFile(join(root, snapshotPath), "utf8"),
			) as ArchiveManifest);

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

const HOSTED_SIGNING_KEY_URL =
	"https://api.secondlayer.tools/public/streams/signing-key";

async function fetchHostedKey(url: string): Promise<string | undefined> {
	// A key fetched over plaintext is whoever sits on the wire, not a key.
	if (!url.startsWith("https://")) return undefined;
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) return undefined;
		const body = (await response.json()) as { public_key_pem?: string };
		return typeof body.public_key_pem === "string"
			? body.public_key_pem
			: undefined;
	} catch {
		// Offline is a legitimate state; the compiled root key still applies.
		return undefined;
	}
}

/**
 * Which key a manifest is checked against, in trust order: an explicit
 * `--public-key`, then `ARCHIVE_SIGNING_PUBLIC_KEY` / `STREAMS_SIGNING_PUBLIC_KEY`
 * from the environment, then the hosted key endpoint over https (never in OSS
 * mode, which must work with no path to api.secondlayer.tools), and finally the
 * key compiled into this release. The compiled key means a fresh self-hosted
 * instance can bootstrap offline; the tradeoff is that rotating it is a CLI
 * release. Plaintext `http://` key sources are never consulted.
 */
export async function resolveArchivePublicKey(input: {
	explicitPem?: string;
	envPem?: string;
	allowHostedApi?: boolean;
	/** Test seam for the hosted endpoint; production callers leave it unset. */
	hostedKeyUrl?: string;
}): Promise<string> {
	if (input.explicitPem) return input.explicitPem;
	if (input.envPem) return input.envPem;
	if (input.allowHostedApi) {
		const hosted = await fetchHostedKey(
			input.hostedKeyUrl ?? HOSTED_SIGNING_KEY_URL,
		);
		if (hosted) return hosted;
	}
	return ARCHIVE_ROOT_PUBLIC_KEY_PEM;
}
