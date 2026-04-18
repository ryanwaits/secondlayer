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
 * chain + transport from environment:
 *   - `STACKS_RPC_URL` → override for the RPC endpoint
 *   - `STACKS_CHAIN=testnet` → select testnet (defaults to mainnet)
 */
let _defaultClient: StacksReadClient | null = null;

export function getDefaultPublicClient(): StacksReadClient {
	if (_defaultClient) return _defaultClient;
	const chain = process.env.STACKS_CHAIN === "testnet" ? testnet : mainnet;
	_defaultClient = createPublicClient({
		chain,
		transport: http(process.env.STACKS_RPC_URL),
	});
	return _defaultClient;
}
