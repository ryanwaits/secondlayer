import type { AbiContract } from "@secondlayer/stacks/clarity";
import got from "got";
import { resolveAuth } from "../lib/resolve-auth.ts";
import type { NetworkName } from "../types/config";

const contractFetch = got.extend({
	timeout: { request: 15000 },
	retry: {
		limit: 0,
		methods: ["GET", "POST"],
		statusCodes: [408, 429, 500, 502, 503, 504],
	},
});

/**
 * Stacks contract client for fetching ABIs via the SecondLayer contract
 * registry (/v1/contracts/:id?include=abi). Mainnet/testnet only — no shipped
 * `sl` command resolves a devnet network, so there's no direct-RPC fallback.
 */
export class StacksApiClient {
	private baseUrl: string;
	private headers: Record<string, string>;

	constructor(
		_network: NetworkName = "mainnet",
		_apiKey?: string,
		slApiUrl?: string,
	) {
		this.baseUrl = slApiUrl?.replace(/\/$/, "") || "";
		this.headers = {};
	}

	/** Lazy-init: resolve tenant API URL + ephemeral bearer */
	private async ensureProxy(): Promise<void> {
		if (this.baseUrl) return;
		const { apiUrl, ephemeralKey } = await resolveAuth();
		this.baseUrl = apiUrl.replace(/\/$/, "");
		this.headers = { authorization: `Bearer ${ephemeralKey}` };
	}

	describeContractInfoSource(): string {
		return "Secondlayer node";
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

		// Prod-safe registry source (the /api/node proxy is OSS/dedicated-only).
		const url = `${this.baseUrl}/v1/contracts/${encodeURIComponent(
			contractId,
		)}?include=abi`;
		const { contract } = await this.fetchWithErrorHandling<{
			contract: { abi?: unknown; abi_status?: string };
		}>(url, "Contract", contractId);
		if (!contract?.abi) {
			throw new Error(
				`ABI not available for ${contractId} (status: ${contract?.abi_status ?? "unknown"})`,
			);
		}
		return contract.abi as AbiContract;
	}
}
