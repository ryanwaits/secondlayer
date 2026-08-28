import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { parseRetryAfter } from "@secondlayer/sdk";
import type { RangeDigest } from "@secondlayer/shared/archive/range-digest";
import { ARCHIVE_ROOT_PUBLIC_KEY_PEM } from "@secondlayer/shared/archive/root-key";
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

/**
 * Every path the archive hands us is resolved against `root`. A manifest that
 * says `../../etc/x` or `/abs/path` would otherwise read outside the archive
 * on disk, or off-origin over the network, with the digest check arriving
 * too late to matter for a local read.
 */
export function assertPathWithinRoot(path: string, root?: string): void {
	const segments = path.split("/");
	const leaves =
		path.startsWith("/") ||
		path.includes("\\") ||
		/^[a-z][a-z0-9+.-]*:/i.test(path) ||
		// Percent-encoding, query, and fragment characters are joined into a
		// remote URL verbatim; `%2e%2e` is `..` once the server decodes it.
		/[%?#]/.test(path) ||
		segments.some((part) => part === "" || part === "." || part === "..");
	if (leaves) {
		throw new Error(`archive path ${path} would leave the archive root`);
	}
	if (root !== undefined) {
		const base = resolve(root);
		const target = resolve(base, path);
		if (target !== base && !target.startsWith(base + sep)) {
			throw new Error(`archive path ${path} would leave the archive root`);
		}
	}
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

export type LoadReferenceOptions = {
	/** Key used to verify a signed `latest.json` pointer. The pointer names
	 *  which snapshot is current, so without this an attacker holding only
	 *  bucket write access could roll every reader back to an older, still
	 *  validly signed, snapshot. */
	publicKeyPem?: string;
};

export async function loadReference(
	source: string,
	options: LoadReferenceOptions = {},
): Promise<LoadedReference> {
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

/**
 * The gate parameter's shape, kept structural rather than imported from
 * `archive-gate.ts` so the two modules stay decoupled — `archive-gate.ts`'s
 * `createGatedFetcher` return value satisfies this by structure alone.
 * `forceRefresh` backs expiry recovery (see below): a second call for the
 * same path after a downstream 403, asking for a fresh presigned URL rather
 * than whatever the gate has cached.
 */
export type ArchiveFetchGate = {
	getUrl(path: string, opts?: { forceRefresh?: boolean }): Promise<string>;
};

/**
 * A partition fetch that gave up. `transient` is true when the cause was the
 * network or the server (reset, timeout, 429, 5xx) and a re-run can pick up
 * where this one stopped; false when the archive answered and the answer was
 * a refusal, which no retry changes.
 */
export class ArchiveFetchError extends Error {
	readonly transient: boolean;
	readonly attempts: number;
	constructor(message: string, opts: { transient: boolean; attempts: number }) {
		super(message);
		this.name = "ArchiveFetchError";
		this.transient = opts.transient;
		this.attempts = opts.attempts;
	}
}

/**
 * Socket-level codes that mean the connection dropped, as opposed to codes
 * like ERR_INVALID_URL that mean the request itself was malformed and no
 * retry fixes. Undici prefixes its own (UND_ERR_SOCKET, UND_ERR_CONNECT_TIMEOUT...).
 */
const TRANSIENT_ERROR_CODES = new Set([
	"ECONNRESET",
	"ECONNREFUSED",
	"ECONNABORTED",
	"ETIMEDOUT",
	"EAI_AGAIN",
	"EPIPE",
	"ENETUNREACH",
	"EHOSTUNREACH",
]);

function isTransientCode(code: unknown): boolean {
	return (
		typeof code === "string" &&
		(TRANSIENT_ERROR_CODES.has(code) || code.startsWith("UND_ERR_"))
	);
}

/** Errors that mean "the bytes never arrived", not "the archive said no". */
export function isTransientFetchFailure(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	if (err.name === "AbortError" || err.name === "TimeoutError") return true;
	// Bun and Node wrap socket errors in a TypeError whose cause carries the code.
	const code = (err as { code?: string }).code;
	const causeCode = (err.cause as { code?: string } | undefined)?.code;
	if (isTransientCode(code) || isTransientCode(causeCode)) return true;
	return (
		err.name === "TypeError" &&
		/fetch failed|network|socket|connection|reset|unreachable/i.test(
			err.message,
		)
	);
}

export const PARTITION_FETCH_RETRIES = 3;
const PARTITION_FETCH_TIMEOUT_MS = 300_000;
const RETRY_BASE_MS = 1_000;
const RETRY_AFTER_CAP_MS = 60_000;

export type FetchImpl = (
	url: string,
	init?: { signal?: AbortSignal },
) => Promise<Response>;

export type RetryingFetchOptions = {
	/** Name for the error message; usually the partition path. */
	label: string;
	retries?: number;
	fetchImpl?: FetchImpl;
	sleep?: (ms: number) => Promise<void>;
	timeoutMs?: number;
};

function retryDelayMs(attempt: number, response?: Response): number {
	const retryAfter = response
		? parseRetryAfter(response.headers.get("retry-after"))
		: undefined;
	if (retryAfter !== undefined) {
		return Math.min(retryAfter * 1_000, RETRY_AFTER_CAP_MS);
	}
	return RETRY_BASE_MS * 2 ** (attempt - 1);
}

/**
 * One fetch that survives the failures a multi-hour restore meets: a socket
 * reset, a 300s timeout, a 429 (honoring `Retry-After`), a 5xx from R2. Each
 * is retried `retries` times with exponential backoff before an
 * `ArchiveFetchError` marked transient surfaces. Any other status is handed
 * back as the response; the caller decides what a 403 or 404 means. The
 * tradeoff is up to 3 extra fetches (7s of backoff, or whatever `Retry-After`
 * asks for, capped at 60s) on a link that is truly down.
 */
export async function fetchWithRetry(
	url: string,
	opts: RetryingFetchOptions,
): Promise<Response> {
	const retries = opts.retries ?? PARTITION_FETCH_RETRIES;
	const fetchImpl = opts.fetchImpl ?? fetch;
	const sleep =
		opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const timeoutMs = opts.timeoutMs ?? PARTITION_FETCH_TIMEOUT_MS;
	let lastReason = "";
	for (let attempt = 1; attempt <= retries + 1; attempt++) {
		let response: Response | undefined;
		try {
			response = await fetchImpl(url, {
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (err) {
			if (!isTransientFetchFailure(err)) throw err;
			lastReason = err instanceof Error ? err.message : String(err);
		}
		if (response) {
			const retryable = response.status === 429 || response.status >= 500;
			if (!retryable) return response;
			lastReason = `${response.status} ${response.statusText}`.trim();
			// Release the connection; the body of a 5xx is not worth keeping.
			await response.body?.cancel().catch(() => {});
		}
		if (attempt <= retries) {
			await sleep(retryDelayMs(attempt, response));
		}
	}
	throw new ArchiveFetchError(
		`could not fetch ${opts.label} after ${retries + 1} attempts (${lastReason})`,
		{ transient: true, attempts: retries + 1 },
	);
}

/** One re-issue on an expired presigned URL, on top of the transient retries
 *  in `fetchWithRetry`. Isolated so `fetchVerifiedPartition` reads as "get
 *  the bytes" regardless of which path produced them. */
async function fetchViaGate(
	gate: ArchiveFetchGate,
	partition: ArchivePartition,
	retried: boolean,
	fetchOpts?: Partial<RetryingFetchOptions>,
): Promise<Buffer> {
	const url = await gate.getUrl(
		partition.path,
		retried ? { forceRefresh: true } : undefined,
	);
	const response = await fetchWithRetry(url, {
		...fetchOpts,
		label: partition.path,
	});
	if (response.status === 403 && !retried) {
		// Presigned URLs expire in 900s; a long-running restore can outlast one.
		// Free within the server's 24h re-issue window, so this is a retry,
		// not a failure.
		await response.body?.cancel().catch(() => {});
		return fetchViaGate(gate, partition, true, fetchOpts);
	}
	if (!response.ok) {
		throw new ArchiveFetchError(
			`could not fetch ${partition.path} (${response.status} ${response.statusText})`,
			{ transient: false, attempts: 1 },
		);
	}
	return Buffer.from(await response.arrayBuffer());
}

/**
 * Fetch a partition and refuse it unless its bytes hash to the digest the
 * signed manifest declares. This is the step that makes repair safe: data only
 * enters a live database after proving it is the data the archive signed.
 *
 * `gate`, when present, replaces the free remote fetch with a metered one —
 * bytes come from `gate.getUrl(partition.path)` (a presigned R2 URL) instead
 * of `reference.root + path`. Everything else, including the digest check
 * below, is unchanged; a presigned URL serving wrong bytes must still fail
 * loudly. Absent `gate`, behavior is byte-for-byte what it was before this
 * parameter existed.
 */
export async function fetchVerifiedPartition(
	reference: LoadedReference,
	partition: ArchivePartition,
	gate?: ArchiveFetchGate,
	/** Test seam for the transport; production callers leave it unset. */
	fetchOpts?: Partial<RetryingFetchOptions>,
): Promise<Buffer> {
	assertPathWithinRoot(
		partition.path,
		reference.isRemote ? undefined : reference.root,
	);
	let bytes: Buffer;
	if (gate) {
		bytes = await fetchViaGate(gate, partition, false, fetchOpts);
	} else if (reference.isRemote) {
		const url = `${reference.root.replace(/\/$/, "")}/${partition.path}`;
		const response = await fetchWithRetry(url, {
			...fetchOpts,
			label: partition.path,
		});
		if (!response.ok) {
			throw new ArchiveFetchError(
				`could not fetch ${partition.path} (${response.status} ${response.statusText})`,
				{ transient: false, attempts: 1 },
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
