import { mainnet, testnet } from "../chains/definitions.ts";
import { createPublicClient } from "../clients/createPublicClient.ts";
import type { Client } from "../clients/types.ts";
import { http } from "../transports/http.ts";

/**
 * Any Stacks client that can perform read-only RPC requests. We only need
 * the base `Client.request` contract; public actions are invoked as
 * free functions in `tools/index.ts`, so we keep this loose.
 */
export type StacksReadClient = Client<Record<string, unknown>>;

/**
 * Lazy-initialized shared client used by the bare tool exports. Resolves
 * chain + transport from environment, using the names the rest of the
 * monorepo already reads, with the older tool-only names as fallbacks:
 *   - network: `STACKS_NETWORK`, then `STACKS_CHAIN` (`testnet` selects
 *     testnet; anything else is mainnet)
 *   - RPC host: `STACKS_NODE_RPC_URL`, then `SL_API_URL`, then
 *     `STACKS_RPC_URL`; unset means the chain's default host
 */
let _defaultClient: StacksReadClient | null = null;

export function getDefaultPublicClient(): StacksReadClient {
	if (_defaultClient) return _defaultClient;
	const network = process.env.STACKS_NETWORK ?? process.env.STACKS_CHAIN;
	const chain = network === "testnet" ? testnet : mainnet;
	const url =
		process.env.STACKS_NODE_RPC_URL ??
		process.env.SL_API_URL ??
		process.env.STACKS_RPC_URL;
	_defaultClient = createPublicClient({
		chain,
		transport: http(url),
	});
	return _defaultClient;
}
