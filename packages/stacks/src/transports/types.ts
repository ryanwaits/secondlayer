import type { StacksChain } from "../chains/types.ts";

/** Function that sends an HTTP request to a Stacks node API path. */
export type RequestFn = (
	path: string,
	options?: RequestOptions,
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
) => Promise<any>;

/** Options for a transport-level HTTP request. */
export type RequestOptions = {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	body?: unknown;
	headers?: Record<string, string>;
	/**
	 * Cancel the request from the caller's side. An aborted signal rejects
	 * with the signal's reason immediately and never retries; it is combined
	 * with the transport's own per-attempt timeout.
	 */
	signal?: AbortSignal;
	/**
	 * Override the transport's retry budget for this one request. Broadcasts
	 * pass `0`: re-sending a transaction the node may already hold trades a
	 * transient failure for a confusing nonce conflict.
	 */
	retryCount?: number;
};

/** Shared configuration for all transport types. */
export type TransportConfig = {
	url?: string;
	/**
	 * Per-attempt deadline in ms covering headers AND body. A stalled body
	 * rejects with `TimeoutError` instead of hanging. Default 30_000.
	 */
	timeout?: number;
	retryCount?: number;
	retryDelay?: number;
	fetchOptions?: RequestInit;
	/** Sent as `x-api-key`. Held in the request closure and stripped from
	 *  `Transport.config` so it never prints with the client. */
	apiKey?: string;
};

/** A resolved transport instance with a bound request function. */
export type Transport = {
	type: string;
	request: RequestFn;
	config: TransportConfig;
	destroy?: () => void;
};

/** Factory that creates a {@link Transport} given an optional chain context. */
export type TransportFactory = (params?: { chain?: StacksChain }) => Transport;
