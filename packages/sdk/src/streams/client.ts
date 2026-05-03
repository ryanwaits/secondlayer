import {
	AuthError,
	RateLimitError,
	StreamsServerError,
	ValidationError,
} from "./errors.ts";
import { streamStreamsEvents } from "./consumer.ts";
import type {
	FetchLike,
	StreamsClient,
	StreamsEventsEnvelope,
	StreamsEventsFetcher,
	StreamsEventsListParams,
	StreamsEventsStreamParams,
	StreamsTip,
} from "./types.ts";

const DEFAULT_STREAMS_BASE_URL = "https://api.secondlayer.tools";

export type CreateStreamsClientOptions = {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: FetchLike;
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

	async function request<T>(path: string): Promise<T> {
		const response = await fetchImpl(`${baseUrl}${path}`, {
			headers: { Authorization: `Bearer ${options.apiKey}` },
		});
		if (!response.ok) await mapStreamsError(response);
		return (await response.json()) as T;
	}

	const fetchEvents: StreamsEventsFetcher = async ({
		cursor,
		limit,
		types,
	}) => {
		return listEvents({ cursor, limit, types });
	};

	async function listEvents(
		params: StreamsEventsListParams = {},
	): Promise<StreamsEventsEnvelope> {
		const searchParams = new URLSearchParams();
		appendSearchParam(searchParams, "cursor", params.cursor);
		appendSearchParam(searchParams, "from_height", params.fromHeight);
		appendSearchParam(searchParams, "to_height", params.toHeight);
		appendSearchParam(searchParams, "limit", params.limit);
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
			stream(params: StreamsEventsStreamParams = {}) {
				return streamStreamsEvents({
					fromCursor: params.fromCursor,
					types: params.types,
					batchSize: params.batchSize ?? 100,
					signal: params.signal,
					fetchEvents,
				});
			},
		},
		tip() {
			return request<StreamsTip>("/v1/streams/tip");
		},
	};
}

function defaultInternalStreamsApiKey(): string {
	const apiKey = process.env.STREAMS_INTERNAL_API_KEY;
	if (apiKey) return apiKey;
	if (process.env.NODE_ENV === "production") {
		throw new Error("STREAMS_INTERNAL_API_KEY is required in production");
	}
	return "sk-sl_streams_enterprise_test";
}

export function createHttpStreamsEventsFetcher(opts?: {
	baseUrl?: string;
	apiKey?: string;
	fetchImpl?: FetchLike;
}): StreamsEventsFetcher {
	const client = createStreamsClient({
		baseUrl: opts?.baseUrl ?? process.env.STREAMS_API_URL,
		apiKey: opts?.apiKey ?? defaultInternalStreamsApiKey(),
		fetchImpl: opts?.fetchImpl,
	});

	return (params) => client.events.list(params);
}
