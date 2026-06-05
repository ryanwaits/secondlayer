import { createHash } from "node:crypto";
import { verifyStreamsBulkManifestSignature } from "@secondlayer/shared/streams-bulk-manifest";
import { StreamsServerError, StreamsSignatureError } from "./errors.ts";
import type {
	FetchLike,
	StreamsDumpFile,
	StreamsDumps,
	StreamsDumpsManifest,
} from "./types.ts";

/**
 * Bulk parquet dumps: the cold backfill path for "download all the raw data".
 *
 * The manifest lives at `<dumpsBaseUrl>/manifest/latest.json` and each file's
 * `path` is the object key under the same base. Downloads are verified against
 * the manifest sha256 so a truncated or tampered file is rejected.
 *
 * When `verifyManifest` is set, the manifest's own ed25519 signature is checked
 * (against the published Streams key) BEFORE any file sha256 is trusted — a
 * sha256 is only as trustworthy as the manifest it came from. Default off until
 * historical manifests have been backfilled with signatures.
 */
export function createStreamsDumps(opts: {
	baseUrl?: string;
	fetchImpl: FetchLike;
	verifyManifest?: boolean;
	loadPublicKeyPem?: () => Promise<string>;
}): StreamsDumps {
	const baseUrl = opts.baseUrl?.replace(/\/+$/, "");

	function requireBaseUrl(): string {
		if (!baseUrl) {
			throw new StreamsServerError(
				"Streams dumps require `dumpsBaseUrl` on createStreamsClient.",
				0,
			);
		}
		return baseUrl;
	}

	function fileUrl(file: StreamsDumpFile): string {
		return `${requireBaseUrl()}/${file.path.replace(/^\/+/, "")}`;
	}

	async function list(): Promise<StreamsDumpsManifest> {
		const url = `${requireBaseUrl()}/manifest/latest.json`;
		const res = await opts.fetchImpl(url);
		if (!res.ok) {
			throw new StreamsServerError(
				`Could not fetch dumps manifest (${res.status}).`,
				res.status,
			);
		}
		const manifest = (await res.json()) as StreamsDumpsManifest;
		if (opts.verifyManifest) {
			if (!opts.loadPublicKeyPem) {
				throw new StreamsSignatureError(
					"Manifest verification is on but no signing key source is configured.",
				);
			}
			const publicKeyPem = await opts.loadPublicKeyPem();
			if (!verifyStreamsBulkManifestSignature(manifest, publicKeyPem)) {
				throw new StreamsSignatureError(
					"Dumps manifest signature is missing or invalid.",
				);
			}
		}
		return manifest;
	}

	async function download(file: StreamsDumpFile): Promise<Uint8Array> {
		const res = await opts.fetchImpl(fileUrl(file));
		if (!res.ok) {
			throw new StreamsServerError(
				`Could not download dump ${file.path} (${res.status}).`,
				res.status,
			);
		}
		const bytes = new Uint8Array(await res.arrayBuffer());
		const digest = createHash("sha256").update(bytes).digest("hex");
		if (digest !== file.sha256) {
			throw new StreamsSignatureError(
				`Dump ${file.path} sha256 mismatch (expected ${file.sha256}, got ${digest}).`,
			);
		}
		return bytes;
	}

	return { list, fileUrl, download };
}
