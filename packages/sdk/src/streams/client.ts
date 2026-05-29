import { ed25519 } from "@secondlayer/shared";
import {
	type StreamsEventsFetcher,
	consumeStreamsEvents,
	streamStreamsEvents,
} from "./consumer.ts";
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
	StreamsEventsStreamParams,
	StreamsReorgsListEnvelope,
	StreamsReorgsListParams,
	StreamsTip,
} from "./types.ts";

const DEFAULT_STREAMS_BASE_URL = "https://api.secondlayer.tools";

export type CreateStreamsClientOptions = {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: FetchLike;
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

function appendSearchParam(
	params: URLSearchParams,
	name: string,
	value: number | string | null | undefined,
): void {
	if (value === undefined || value === null) return;
	params.set(name, String(value));
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

	// Lazily resolve and cache the verification public key.
	let publicKeyPromise: Promise<
		ReturnType<typeof ed25519.loadEd25519PublicKey>
	> | null = null;
	function getPublicKey() {
		if (publicKeyPromise) return publicKeyPromise;
		publicKeyPromise = (async () => {
			if (typeof verify === "object") {
				return ed25519.loadEd25519PublicKey(verify.publicKey);
			}
			const res = await fetchImpl(`${baseUrl}/public/streams/signing-key`);
			if (!res.ok) {
				throw new StreamsSignatureError(
					`Could not fetch signing key (${res.status}).`,
				);
			}
			const body = (await res.json()) as { public_key_pem?: string };
			if (!body.public_key_pem) {
				throw new StreamsSignatureError("Signing key response missing key.");
			}
			return ed25519.loadEd25519PublicKey(body.public_key_pem);
		})();
		return publicKeyPromise;
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
			const publicKey = await getPublicKey();
			if (!ed25519.verifyEd25519(text, signature, publicKey)) {
				throw new StreamsSignatureError();
			}
		}
		return JSON.parse(text) as T;
	}

	const fetchEvents: StreamsEventsFetcher = async ({
		cursor,
		limit,
		types,
		contractId,
		sender,
		recipient,
		assetIdentifier,
	}) => {
		return listEvents({
			cursor,
			limit,
			types,
			contractId,
			sender,
			recipient,
			assetIdentifier,
		});
	};

	async function listEvents(
		params: StreamsEventsListParams = {},
	): Promise<StreamsEventsEnvelope> {
		const searchParams = new URLSearchParams();
		appendSearchParam(searchParams, "cursor", params.cursor);
		appendSearchParam(searchParams, "from_height", params.fromHeight);
		appendSearchParam(searchParams, "to_height", params.toHeight);
		appendSearchParam(searchParams, "limit", params.limit);
		appendSearchParam(searchParams, "contract_id", params.contractId);
		appendSearchParam(searchParams, "sender", params.sender);
		appendSearchParam(searchParams, "recipient", params.recipient);
		appendSearchParam(searchParams, "asset_identifier", params.assetIdentifier);
		if (params.types?.length) {
			searchParams.set("types", params.types.join(","));
		}

		const query = searchParams.toString();
		return request<StreamsEventsEnvelope>(
			`/v1/streams/events${query ? `?${query}` : ""}`,
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
					types: params.types,
					contractId: params.contractId,
					sender: params.sender,
					recipient: params.recipient,
					assetIdentifier: params.assetIdentifier,
					batchSize: params.batchSize ?? 100,
					fetchEvents,
					onBatch: params.onBatch,
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
				const searchParams = new URLSearchParams();
				appendSearchParam(searchParams, "since", params.since);
				appendSearchParam(searchParams, "limit", params.limit);
				const query = searchParams.toString();
				return request<StreamsReorgsListEnvelope>(
					`/v1/streams/reorgs${query ? `?${query}` : ""}`,
				);
			},
		},
		canonical(height: number) {
			return request<StreamsCanonicalBlock>(`/v1/streams/canonical/${height}`);
		},
		tip() {
			return request<StreamsTip>("/v1/streams/tip");
		},
	};
}
