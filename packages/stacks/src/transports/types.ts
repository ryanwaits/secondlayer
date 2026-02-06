import type { StacksChain } from "../chains/types.ts";

export type RequestFn = (
  path: string,
  options?: RequestOptions
) => Promise<any>;

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

export type TransportConfig = {
  url?: string;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
  fetchOptions?: RequestInit;
  apiKey?: string;
};

export type Transport = {
  type: string;
  request: RequestFn;
  config: TransportConfig;
};

export type TransportFactory = (params?: { chain?: StacksChain }) => Transport;
