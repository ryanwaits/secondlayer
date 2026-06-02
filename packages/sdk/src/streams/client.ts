import { ed25519 } from "@secondlayer/shared";
import { buildQuery } from "../base.ts";
import {
	type StreamsEventsFetcher,
	consumeStreamsEvents,
	streamStreamsEvents,
} from "./consumer.ts";
import { createStreamsDumps } from "./dumps.ts";
import {
	AuthError,
	RateLimitError,
	StreamsServerError,
	StreamsSignatureError,
	ValidationError,
} from "./errors.ts";
import type {
	FetchLike,
	StreamsCanonicalBlock,
	StreamsClient,
	StreamsEventsConsumeParams,
	StreamsEventsEnvelope,
	StreamsEventsListEnvelope,
	StreamsEventsListParams,
	StreamsEventsReplayParams,
	StreamsEventsStreamParams,
	StreamsReorgsListEnvelope,
	StreamsReorgsListParams,
	StreamsTip,
} from "./types.ts";

/** Parse a `<block>:<index>` cursor; null sorts before genesis. */
function cursorTuple(cursor: string | null): [number, number] {
	if (!cursor) return [-1, -1];
	const parts = cursor.split(":");
	const [block, index] = parts.map(Number);
	if (
		parts.length !== 2 ||
		!Number.isInteger(block) ||
		!Number.isInteger(index)
	) {
		throw new ValidationError(
			`Invalid stream cursor "${cursor}"; expected "<block>:<index>" (e.g. "951475:3").`,
			400,
		);
	}
	return [block, index];
}

/** The greater of two cursors (later in the stream). */
function maxCursor(a: string | null, b: string | null): string | null {
	const [ah, ai] = cursorTuple(a);
	const [bh, bi] = cursorTuple(b);
	return ah > bh || (ah === bh && ai >= bi) ? a : b;
}

const DEFAULT_STREAMS_BASE_URL = "https://api.secondlayer.tools";

export type CreateStreamsClientOptions = {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: FetchLike;
	/**
	 * Public base URL for bulk parquet dumps (the R2/CDN bucket root). Required
	 * to use `client.dumps`. See `GET /public/streams/dumps/manifest`.
	 */
	dumpsBaseUrl?: string;
	/**
	 * Verify the ed25519 `X-Signature` on every response (default off). Pass
	 * `true` to fetch the server's public key from
	 * `/public/streams/signing-key`, or `{ publicKey }` to pin a known PEM. A
	 * failed or missing signature throws `StreamsSignatureError`.
	 */
	verify?: boolean | { publicKey: string };
};

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

async function responseBody(response: Response): Promise<unknown> {
	const text = await response.text();
	if (text.length === 0) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function errorMessage(body: unknown, fallback: string): string {
	if (body && typeof body === "object") {
		const record = body as Record<string, unknown>;
		const message = record.error ?? record.message;
		if (typeof message === "string" && message.length > 0) return message;
	}
	if (typeof body === "string" && body.length > 0) return body;
	return fallback;
}

async function mapStreamsError(response: Response): Promise<never> {
	const body = await responseBody(response);

	if (response.status === 401) {
		throw new AuthError(errorMessage(body, "API key invalid or expired."));
	}

	if (response.status === 429) {
		const retryAfter = response.headers.get("Retry-After") ?? undefined;
		throw new RateLimitError(
			errorMessage(body, "Rate limited. Try again later."),
			retryAfter,
		);
	}

	if (response.status >= 500) {
		throw new StreamsServerError(
			errorMessage(body, `Streams server returned ${response.status}.`),
			response.status,
			body,
		);
	}

	throw new ValidationError(
		errorMessage(body, `Streams request returned ${response.status}.`),
		response.status,
		body,
	);
}

export function createStreamsClient(
	options: CreateStreamsClientOptions,
): StreamsClient {
	const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_STREAMS_BASE_URL);
	const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
	const verify = options.verify ?? false;
	const dumps = createStreamsDumps({
		baseUrl: options.dumpsBaseUrl,
		fetchImpl,
	});

	// Lazily resolve and cache the verification key alongside its id, so a
	// rotation (signalled by a changed `X-Signature-KeyId`) can be detected.
	type VerificationKey = {
		keyId: string;
		publicKey: ReturnType<typeof ed25519.loadEd25519PublicKey>;
	};
	let keyPromise: Promise<VerificationKey> | null = null;
	function loadKey(): Promise<VerificationKey> {
		if (keyPromise) return keyPromise;
		keyPromise = (async () => {
			if (typeof verify === "object") {
				return {
					keyId: ed25519.ed25519KeyId(verify.publicKey),
					publicKey: ed25519.loadEd25519PublicKey(verify.publicKey),
				};
			}
			const res = await fetchImpl(`${baseUrl}/public/streams/signing-key`);
			if (!res.ok) {
				throw new StreamsSignatureError(
					`Could not fetch signing key (${res.status}).`,
				);
			}
			const body = (await res.json()) as {
				public_key_pem?: string;
				key_id?: string;
			};
			if (!body.public_key_pem) {
				throw new StreamsSignatureError("Signing key response missing key.");
			}
			return {
				keyId: body.key_id ?? ed25519.ed25519KeyId(body.public_key_pem),
				publicKey: ed25519.loadEd25519PublicKey(body.public_key_pem),
			};
		})();
		return keyPromise;
	}

	async function request<T>(path: string): Promise<T> {
		const response = await fetchImpl(`${baseUrl}${path}`, {
			headers: { Authorization: `Bearer ${options.apiKey}` },
		});
		if (!response.ok) await mapStreamsError(response);
		const text = await response.text();
		if (verify) {
			const signature = response.headers.get("X-Signature");
			if (!signature) {
				throw new StreamsSignatureError("Response is missing X-Signature.");
			}
			const responseKeyId = response.headers.get("X-Signature-KeyId");
			let key = await loadKey();
			// The server rotated to a key we haven't seen.
			if (responseKeyId && responseKeyId !== key.keyId) {
				if (typeof verify === "object") {
					// Pinned key: a different id is never the pinned key — fail closed.
					throw new StreamsSignatureError(
						`Response signed with key '${responseKeyId}', expected pinned key '${key.keyId}'.`,
					);
				}
				// Fetched key: refresh once. A still-mismatched id (no re-loop)
				// means the endpoint doesn't serve the signing key — fail closed.
				keyPromise = null;
				key = await loadKey();
				if (responseKeyId !== key.keyId) {
					throw new StreamsSignatureError(
						`Response signed with key '${responseKeyId}' not served by the signing-key endpoint.`,
					);
				}
			}
			if (!ed25519.verifyEd25519(text, signature, key.publicKey)) {
				throw new StreamsSignatureError();
			}
		}
		return JSON.parse(text) as T;
	}

	const fetchEvents: StreamsEventsFetcher = async ({
		cursor,
		limit,
		types,
		notTypes,
		contractId,
		sender,
		recipient,
		assetIdentifier,
	}) => {
		return listEvents({
			cursor,
			limit,
			types,
			notTypes,
			contractId,
			sender,
			recipient,
			assetIdentifier,
		});
	};

	async function listEvents(
		params: StreamsEventsListParams = {},
	): Promise<StreamsEventsEnvelope> {
		return request<StreamsEventsEnvelope>(
			`/v1/streams/events${buildQuery({
				cursor: params.cursor,
				from_height: params.fromHeight,
				to_height: params.toHeight,
				limit: params.limit,
				contract_id: params.contractId,
				sender: params.sender,
				recipient: params.recipient,
				asset_identifier: params.assetIdentifier,
				types: params.types,
				not_types: params.notTypes,
			})}`,
		);
	}

	return {
		events: {
			list: listEvents,
			byTxId(txId: string) {
				return request<StreamsEventsListEnvelope>(
					`/v1/streams/events/${encodeURIComponent(txId)}`,
				);
			},
			consume(params: StreamsEventsConsumeParams) {
				return consumeStreamsEvents({
					fromCursor: params.fromCursor,
					mode: params.mode,
					finalizedOnly: params.finalizedOnly,
					types: params.types,
					notTypes: params.notTypes,
					contractId: params.contractId,
					sender: params.sender,
					recipient: params.recipient,
					assetIdentifier: params.assetIdentifier,
					batchSize: params.batchSize ?? 100,
					fetchEvents,
					onBatch: params.onBatch,
					onReorg: params.onReorg,
					emptyBackoffMs: params.emptyBackoffMs,
					maxPages: params.maxPages,
					maxEmptyPolls: params.maxEmptyPolls,
					signal: params.signal,
				});
			},
			stream(params: StreamsEventsStreamParams = {}) {
				return streamStreamsEvents({
					fromCursor: params.fromCursor,
					types: params.types,
					notTypes: params.notTypes,
					contractId: params.contractId,
					sender: params.sender,
					recipient: params.recipient,
					assetIdentifier: params.assetIdentifier,
					batchSize: params.batchSize ?? 100,
					emptyBackoffMs: params.emptyBackoffMs,
					maxPages: params.maxPages,
					maxEmptyPolls: params.maxEmptyPolls,
					signal: params.signal,
					fetchEvents,
				});
			},
			async replay(params: StreamsEventsReplayParams) {
				const fromCursor =
					params.from === "genesis" ? null : (params.from ?? null);
				const fromBlock = fromCursor ? cursorTuple(fromCursor)[0] : 0;
				const manifest = await dumps.list();

				// Hydrate finalized history from dumps, in block order.
				const files = manifest.files
					.filter((file) => file.to_block >= fromBlock)
					.sort(
						(a, b) => a.from_block - b.from_block || a.to_block - b.to_block,
					);
				for (const file of files) {
					if (params.signal?.aborted) break;
					await params.onDumpFile(file);
				}

				// Seam: tail live from just past the dumped coverage. Cursor input is
				// exclusive, so the first live event is strictly after the last dump.
				const seam = maxCursor(fromCursor, manifest.latest_finalized_cursor);
				return consumeStreamsEvents({
					fromCursor: seam,
					mode: params.mode ?? "tail",
					batchSize: params.batchSize ?? 100,
					fetchEvents,
					onBatch: params.onBatch,
					emptyBackoffMs: params.emptyBackoffMs,
					maxPages: params.maxPages,
					maxEmptyPolls: params.maxEmptyPolls,
					signal: params.signal,
				});
			},
		},
		blocks: {
			events(heightOrHash: number | string) {
				return request<StreamsEventsListEnvelope>(
					`/v1/streams/blocks/${encodeURIComponent(String(heightOrHash))}/events`,
				);
			},
		},
		reorgs: {
			list(params: StreamsReorgsListParams) {
				return request<StreamsReorgsListEnvelope>(
					`/v1/streams/reorgs${buildQuery({
						since: params.since,
						limit: params.limit,
					})}`,
				);
			},
		},
		dumps,
		canonical(height: number) {
			return request<StreamsCanonicalBlock>(`/v1/streams/canonical/${height}`);
		},
		tip() {
			return request<StreamsTip>("/v1/streams/tip");
		},
	};
}
