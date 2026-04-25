import type { AbiContract } from "@secondlayer/stacks/clarity";
import got from "got";
import { resolveActiveTenant } from "../lib/resolve-tenant.ts";
import type { NetworkName } from "../types/config";
import { parseContractId } from "./contract-id";

const contractFetch = got.extend({
	timeout: { request: 15000 },
	retry: {
		limit: 0,
		methods: ["GET", "POST"],
		statusCodes: [408, 429, 500, 502, 503, 504],
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
			this.baseUrl = slApiUrl?.replace(/\/$/, "") || "";
			this.headers = {};
		} else {
			this.baseUrl =
				apiUrl || process.env.STACKS_NODE_RPC_URL || "http://localhost:3999";
			this.headers = apiKey ? { "x-api-key": apiKey } : {};
		}
	}

	/** Lazy-init: resolve tenant API URL + ephemeral bearer if using proxy */
	private async ensureProxy(): Promise<void> {
		if (!this.useProxy || this.baseUrl) return;
		const { apiUrl, ephemeralKey } = await resolveActiveTenant();
		this.baseUrl = apiUrl.replace(/\/$/, "");
		this.headers = { authorization: `Bearer ${ephemeralKey}` };
	}

	describeContractInfoSource(): string {
		if (this.useProxy) return "Secondlayer node";
		return `Stacks node RPC at ${this.baseUrl}`;
	}

	private async fetchWithErrorHandling<T>(
		url: string,
		resourceType: string,
		resourceId: string,
	): Promise<T> {
		try {
			const response = await contractFetch(url, {
				headers: this.headers,
				responseType: "json",
			});
			return response.body as T;
		} catch (error: unknown) {
			const statusCode =
				typeof error === "object" &&
				error !== null &&
				"response" in error &&
				typeof error.response === "object" &&
				error.response !== null &&
				"statusCode" in error.response
					? error.response.statusCode
					: undefined;
			const message = error instanceof Error ? error.message : String(error);

			if (statusCode === 401) {
				throw new Error("Authentication required. Run: secondlayer auth login");
			}
			if (statusCode === 404) {
				throw new Error(`${resourceType} not found: ${resourceId}`);
			}
			throw new Error(
				`Failed to fetch ${resourceType.toLowerCase()}: ${message}`,
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
