import got from "got";
import type { AbiContract } from "@secondlayer/stacks/clarity";
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
 * Stacks API client for fetching contract information.
 *
 * URL resolution order:
 *   1. Explicit `apiUrl` constructor arg
 *   2. `STACKS_NODE_RPC_URL` env var
 *   3. Hiro public API (fallback)
 */

const HIRO_URLS: Record<NetworkName, string> = {
  mainnet: "https://api.hiro.so",
  testnet: "https://api.testnet.hiro.so",
  devnet: "http://localhost:3999",
};

export class StacksApiClient {
  private static hasWarnedAboutApiKey = false;
  private baseUrl: string;
  private headers: Record<string, string>;
  private usingHiro: boolean;

  constructor(
    network: NetworkName = "mainnet",
    apiKey?: string,
    apiUrl?: string
  ) {
    const nodeRpcUrl = process.env.STACKS_NODE_RPC_URL;
    this.baseUrl = apiUrl || nodeRpcUrl || HIRO_URLS[network];
    this.usingHiro = !apiUrl && !nodeRpcUrl;
    this.headers = apiKey ? { "x-api-key": apiKey } : {};

    if (this.usingHiro && !apiKey && !StacksApiClient.hasWarnedAboutApiKey) {
      console.warn(
        "⚠️  Using Hiro public API (no STACKS_NODE_RPC_URL set). You may be rate-limited.\n" +
          "   Set STACKS_NODE_RPC_URL to use your own node, or set HIRO_API_KEY for Hiro.\n" +
          "   Get a free Hiro key at: https://platform.hiro.so/"
      );
      StacksApiClient.hasWarnedAboutApiKey = true;
    }
  }

  private async fetchWithErrorHandling<T>(
    url: string,
    resourceType: string,
    resourceId: string
  ): Promise<T> {
    try {
      const response = await gotWithRetry(url, {
        headers: this.headers,
        responseType: "json",
      });
      return response.body as T;
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        throw new Error(`${resourceType} not found: ${resourceId}`);
      }
      if (error.response?.statusCode === 429) {
        throw new Error("Rate limited. Please provide an API key in your config.");
      }
      throw new Error(`Failed to fetch ${resourceType.toLowerCase()}: ${error.message}`);
    }
  }

  async getContractInfo(contractId: string): Promise<AbiContract> {
    const { address, contractName } = parseContractId(contractId);
    const url = `${this.baseUrl}/v2/contracts/interface/${address}/${contractName}`;
    return this.fetchWithErrorHandling<AbiContract>(url, "Contract", contractId);
  }

  async getContractSource(contractId: string): Promise<string> {
    const { address, contractName } = parseContractId(contractId);
    const url = `${this.baseUrl}/v2/contracts/source/${address}/${contractName}`;
    const data = await this.fetchWithErrorHandling<{ source: string }>(url, "Contract source", contractId);
    return data.source;
  }
}
