import { createHash } from "node:crypto";
import {
	checkSignature,
	loadReference,
} from "@secondlayer/shared/archive/reference";
import type { ArchiveStatus } from "@secondlayer/shared/archive/status";
import {
	type FetchLike,
	parseErrorEnvelope,
	resolveAccountKey,
} from "../base.ts";
import {
	ApiError,
	ArchiveAuthError,
	ArchiveGateNotConfiguredError,
	ArchiveSignatureError,
	InsufficientArchiveCreditsError,
	ValidationError,
} from "../errors.ts";
import type {
	ArchiveClient,
	ArchiveCreditsBalance,
	ArchiveDataset,
	ArchiveFetchItem,
	ArchiveFetchResult,
	ArchiveFlow,
	ArchiveLoadOptions,
	ArchivePartition,
	ArchiveQuote,
	LoadedArchive,
} from "./types.ts";

/** Official hosted archive. Partition bytes on this host are gated — download
 *  without a presigned URL from `fetch()` is refused. Same host string as
 *  `OFFICIAL_ARCHIVE_HOST` in the CLI gate. */
const OFFICIAL_ARCHIVE_HOST = "archive.secondlayer.tools";

const DEFAULT_ARCHIVE_BASE_URL = "https://archive.secondlayer.tools";
const DEFAULT_ARCHIVE_OPS_URL = "https://api.secondlayer.tools";
const MAX_FETCH_BATCH = 64;

/** Match CLI: hosted account keys are `sk-sl_*` or `ss-sl_*`. */
const ARCHIVE_CREDENTIAL_RE = /^s[ks]-sl_/;

export type CreateArchiveClientOptions = {
	/** @deprecated Prefer `accountKey`. Kept one release as an alias. */
	apiKey?: string;
	accountKey?: string;
	fetchImpl?: FetchLike;
	archiveBaseUrl?: string;
	archiveOpsUrl?: string;
	verifyManifest?: boolean;
	publicKeyPem?: string;
};

type QuoteResponseBody = {
	partitions: number;
	bundles: number;
	usd_micros: number;
	usd: string;
	free_allowance_applied_micros: number;
	allowance_remaining_bundles: number;
	balance_usd_micros: number;
	sufficient: boolean;
};

type FetchResponseBody = {
	urls: Array<{
		path: string;
		url: string;
		expires_at: string;
		charged_usd_micros: number;
	}>;
	charged_total_usd_micros: number;
	balance_after_usd_micros: number;
};

function quoteFromBody(body: QuoteResponseBody): ArchiveQuote {
	return {
		partitions: body.partitions,
		bundles: body.bundles,
		usdMicros: body.usd_micros,
		usd: body.usd,
		freeAllowanceAppliedMicros: body.free_allowance_applied_micros,
		allowanceRemainingBundles: body.allowance_remaining_bundles,
		balanceUsdMicros: body.balance_usd_micros,
		sufficient: body.sufficient,
	};
}

function stripSlash(url: string): string {
	return url.replace(/\/+$/, "");
}

export function createArchiveClient(
	options: CreateArchiveClientOptions = {},
): ArchiveClient {
	const accountKey = resolveAccountKey(options.accountKey ?? options.apiKey);
	const fetchImpl: FetchLike =
		options.fetchImpl ?? ((input, init) => fetch(input, init));
	const archiveBaseUrl = stripSlash(
		options.archiveBaseUrl ?? DEFAULT_ARCHIVE_BASE_URL,
	);
	const archiveOpsUrl = stripSlash(
		options.archiveOpsUrl ?? DEFAULT_ARCHIVE_OPS_URL,
	);
	const verifyManifest = options.verifyManifest ?? true;
	const pinnedPem = options.publicKeyPem;

	let keyPromise: Promise<string> | null = null;

	async function fetchSigningKey(): Promise<string> {
		if (pinnedPem) return pinnedPem;
		if (keyPromise) return keyPromise;
		const pending = (async () => {
			const res = await fetchImpl(
				`${archiveOpsUrl}/public/streams/signing-key`,
			);
			if (!res.ok) {
				throw new ArchiveSignatureError(
					`Could not fetch archive signing key (${res.status}).`,
				);
			}
			const body = (await res.json()) as { public_key_pem?: string };
			if (typeof body.public_key_pem !== "string") {
				throw new ArchiveSignatureError("Signing key response missing key.");
			}
			return body.public_key_pem;
		})();
		keyPromise = pending;
		pending.catch(() => {
			if (keyPromise === pending) keyPromise = null;
		});
		return pending;
	}

	async function throwOpsError(response: Response): Promise<never> {
		const envelope = parseErrorEnvelope(await response.text());
		if (response.status === 401) {
			throw new ArchiveAuthError(
				envelope.message ?? "Archive ops request was not authenticated.",
			);
		}
		if (response.status === 402) {
			const raw =
				envelope.body &&
				typeof envelope.body === "object" &&
				"shortfall_usd_micros" in envelope.body
					? Number(
							(envelope.body as { shortfall_usd_micros?: unknown })
								.shortfall_usd_micros,
						)
					: undefined;
			throw new InsufficientArchiveCreditsError(
				envelope.message ?? "Insufficient archive credits.",
				Number.isFinite(raw) ? raw : undefined,
			);
		}
		if (response.status === 503) {
			throw new ArchiveGateNotConfiguredError(
				envelope.message ?? "The archive gate is not configured on the server.",
			);
		}
		throw new ApiError(
			response.status,
			envelope.message ?? `Archive ops returned ${response.status}.`,
			envelope.body,
			envelope.code,
		);
	}

	async function opsRequest<T>(
		method: string,
		path: string,
		body?: unknown,
		authed = true,
	): Promise<T> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (authed && accountKey) {
			if (!ARCHIVE_CREDENTIAL_RE.test(accountKey)) {
				throw new ArchiveAuthError(
					"archive ops need SECONDLAYER_API_KEY (sk-sl_*), not INSTANCE_TOKEN",
				);
			}
			headers.Authorization = `Bearer ${accountKey}`;
		}
		const response = await fetchImpl(`${archiveOpsUrl}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) await throwOpsError(response);
		return (await response.json()) as T;
	}

	async function load(
		against: string,
		opts: ArchiveLoadOptions = {},
	): Promise<LoadedArchive> {
		if (!/^https?:\/\//i.test(against)) {
			throw new ValidationError(
				"archive.load() accepts only http(s) URLs; local paths stay on the CLI.",
				400,
			);
		}
		const insecure = opts.insecure === true;
		const publicKeyPem =
			pinnedPem ??
			(verifyManifest && !insecure ? await fetchSigningKey() : undefined);
		const ref = await loadReference(against, {
			publicKeyPem,
			fetchImpl,
		});
		const signature = checkSignature(ref.manifest, publicKeyPem, insecure);
		if (verifyManifest && !insecure && !signature.verified) {
			throw new ArchiveSignatureError(
				signature.reason ?? "Archive manifest signature is missing or invalid.",
			);
		}
		return { ...ref, signature };
	}

	async function latest(
		against?: string,
		opts: ArchiveLoadOptions = {},
	): Promise<LoadedArchive> {
		return load(against ?? `${archiveBaseUrl}/latest.json`, opts);
	}

	async function status(): Promise<ArchiveStatus> {
		const response = await fetchImpl(`${archiveBaseUrl}/status.json`);
		if (!response.ok) {
			throw new ApiError(
				response.status,
				`Could not fetch archive status (${response.status}).`,
			);
		}
		return (await response.json()) as ArchiveStatus;
	}

	function partitions(
		ref: LoadedArchive,
		filter?: {
			dataset?: ArchiveDataset;
			fromBlock?: number;
			toBlock?: number;
		},
	): ArchivePartition[] {
		let list = ref.manifest.partitions ?? [];
		if (!filter) return list;
		if (filter.dataset) {
			list = list.filter((p) => p.dataset === filter.dataset);
		}
		const fromBlock = filter.fromBlock;
		if (fromBlock !== undefined) {
			list = list.filter((p) => p.to_block >= fromBlock);
		}
		const toBlock = filter.toBlock;
		if (toBlock !== undefined) {
			list = list.filter((p) => p.from_block <= toBlock);
		}
		return list;
	}

	async function quote(input: {
		paths: string[];
		flow: ArchiveFlow;
	}): Promise<ArchiveQuote> {
		const body = await opsRequest<QuoteResponseBody>(
			"POST",
			"/api/archive/quote",
			{ paths: input.paths, flow: input.flow },
		);
		return quoteFromBody(body);
	}

	async function fetchPartitions(input: {
		paths: string[];
		flow: ArchiveFlow;
	}): Promise<ArchiveFetchResult> {
		const urls: ArchiveFetchItem[] = [];
		let chargedTotalUsdMicros = 0;
		let balanceAfterUsdMicros = 0;
		for (let i = 0; i < input.paths.length; i += MAX_FETCH_BATCH) {
			const chunk = input.paths.slice(i, i + MAX_FETCH_BATCH);
			const body = await opsRequest<FetchResponseBody>(
				"POST",
				"/api/archive/fetch",
				{ paths: chunk, flow: input.flow },
			);
			for (const item of body.urls) {
				urls.push({
					path: item.path,
					url: item.url,
					expiresAt: item.expires_at,
					chargedUsdMicros: item.charged_usd_micros,
				});
			}
			chargedTotalUsdMicros += body.charged_total_usd_micros;
			balanceAfterUsdMicros = body.balance_after_usd_micros;
		}
		return { urls, chargedTotalUsdMicros, balanceAfterUsdMicros };
	}

	async function download(
		partition: ArchivePartition,
		opts?: { url?: string },
	): Promise<Uint8Array> {
		let url = opts?.url;
		if (!url) {
			let official = false;
			try {
				official = new URL(archiveBaseUrl).hostname === OFFICIAL_ARCHIVE_HOST;
			} catch {
				official = false;
			}
			if (official) {
				throw new ValidationError(
					"Official archive host requires a presigned URL from archive.fetch() before download.",
					400,
				);
			}
			url = `${archiveBaseUrl}/${partition.path.replace(/^\/+/, "")}`;
		}
		const response = await fetchImpl(url);
		if (!response.ok) {
			throw new ApiError(
				response.status,
				`Could not download ${partition.path} (${response.status}).`,
			);
		}
		const bytes = new Uint8Array(await response.arrayBuffer());
		const digest = createHash("sha256").update(bytes).digest("hex");
		if (digest !== partition.sha256) {
			throw new ArchiveSignatureError(
				`${partition.path} sha256 mismatch (expected ${partition.sha256}, got ${digest}).`,
			);
		}
		return bytes;
	}

	return {
		latest,
		load,
		status,
		partitions,
		quote,
		fetch: fetchPartitions,
		download,
		credits: {
			async balance(): Promise<ArchiveCreditsBalance> {
				const body = await opsRequest<{
					creditsUsdMicros: string;
					refill: ArchiveCreditsBalance["refill"];
				}>("GET", "/api/billing/status");
				return {
					creditsUsdMicros: body.creditsUsdMicros,
					refill: body.refill,
				};
			},
			async checkout(input: {
				email: string;
				pack: 10 | 25 | 50 | 100;
			}): Promise<{ url: string }> {
				const body = await opsRequest<{ url: string }>(
					"POST",
					"/api/public/credits/checkout",
					{ email: input.email, amount: input.pack },
					false,
				);
				return { url: body.url };
			},
			async refill(
				input:
					| { belowUsd: number; packUsd: 10 | 25 | 50 | 100 }
					| { off: true },
			): Promise<{ belowUsd: number | null; packUsd: number | null }> {
				const payload =
					"off" in input && input.off
						? { belowUsd: null }
						: {
								belowUsd: (input as { belowUsd: number }).belowUsd,
								packUsd: (input as { packUsd: 10 | 25 | 50 | 100 }).packUsd,
							};
				const body = await opsRequest<{
					belowUsd: number | null;
					packUsd: number | null;
				}>("POST", "/api/billing/refill", payload);
				return { belowUsd: body.belowUsd, packUsd: body.packUsd };
			},
		},
	};
}
