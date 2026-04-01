import type { AbiContract } from "@secondlayer/stacks/clarity";
import got from "got";
import { authHeaders } from "../lib/api-client.ts";
import { loadConfig, resolveApiUrl } from "../lib/config.ts";
import type { NetworkName } from "../types/config";
import { parseContractId } from "./contract-id";

const gotWithRetry = got.extend({
	timeout: { request: 30000 },
	retry: {
		limit: 3,
		methods: ["GET", "POST"],
		statusCodes: [408, 429, 500, 502, 503, 504],
		calculateDelay: ({ attemptCount }) => attemptCount * 1000,
	},
});

/**
 * Stacks contract client for fetching ABIs and source code.
 *
 * Mainnet/testnet: proxied through SecondLayer API (/api/node/contracts/:id/abi)
 * Devnet: direct RPC to local node (STACKS_NODE_RPC_URL or localhost:3999)
 */
export class StacksApiClient {
	private baseUrl: string;
	private headers: Record<string, string>;
	private useProxy: boolean;

	constructor(
		network: NetworkName = "mainnet",
		apiKey?: string,
		apiUrl?: string,
		slApiUrl?: string,
	) {
		this.useProxy = !apiUrl && network !== "devnet";

		if (this.useProxy) {
			this.baseUrl = slApiUrl || "";
			this.headers = {};
		} else {
			this.baseUrl =
				apiUrl || process.env.STACKS_NODE_RPC_URL || "http://localhost:3999";
			this.headers = apiKey ? { "x-api-key": apiKey } : {};
		}
	}

	/** Lazy-init: resolve SecondLayer API URL + auth from config if using proxy */
	private async ensureProxy(): Promise<void> {
		if (!this.useProxy || this.baseUrl) return;
		const config = await loadConfig();
		this.baseUrl = resolveApiUrl(config);
		this.headers = authHeaders(config);
	}

	private async fetchWithErrorHandling<T>(
		url: string,
		resourceType: string,
		resourceId: string,
	): Promise<T> {
		try {
			const response = await gotWithRetry(url, {
				headers: this.headers,
				responseType: "json",
			});
			return response.body as T;
		} catch (error: any) {
			if (error.response?.statusCode === 401) {
				throw new Error("Authentication required. Run: secondlayer auth login");
			}
			if (error.response?.statusCode === 404) {
				throw new Error(`${resourceType} not found: ${resourceId}`);
			}
			throw new Error(
				`Failed to fetch ${resourceType.toLowerCase()}: ${error.message}`,
			);
		}
	}

	async getContractInfo(contractId: string): Promise<AbiContract> {
		await this.ensureProxy();

		if (this.useProxy) {
			const url = `${this.baseUrl}/api/node/contracts/${contractId}/abi`;
			return this.fetchWithErrorHandling<AbiContract>(
				url,
				"Contract",
				contractId,
			);
		}

		const { address, contractName } = parseContractId(contractId);
		const url = `${this.baseUrl}/v2/contracts/interface/${address}/${contractName}`;
		return this.fetchWithErrorHandling<AbiContract>(
			url,
			"Contract",
			contractId,
		);
	}

	async getContractSource(contractId: string): Promise<string> {
		// Source endpoint is only available via direct RPC
		const { address, contractName } = parseContractId(contractId);
		const rpcUrl = process.env.STACKS_NODE_RPC_URL || this.baseUrl;
		const url = `${rpcUrl}/v2/contracts/source/${address}/${contractName}`;
		const data = await this.fetchWithErrorHandling<{ source: string }>(
			url,
			"Contract source",
			contractId,
		);
		return data.source;
	}
}
