import type { StacksChain } from "../chains/types.ts";

/** Function that sends an HTTP request to a Stacks node API path. */
export type RequestFn = (
  path: string,
  options?: RequestOptions
) => Promise<any>;

/** Options for a transport-level HTTP request. */
export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

/** Shared configuration for all transport types. */
export type TransportConfig = {
  url?: string;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
  fetchOptions?: RequestInit;
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
