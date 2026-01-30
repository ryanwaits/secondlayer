import got from "got";
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
 * Stacks API client for fetching contract information
 */

const API_URLS: Record<NetworkName, string> = {
  mainnet: "https://api.hiro.so",
  testnet: "https://api.testnet.hiro.so",
  devnet: "http://localhost:3999",
};

export interface ContractInfo {
  functions: any[];
  variables?: any[];
  maps?: any[];
  fungible_tokens?: any[];
  non_fungible_tokens?: any[];
  epoch?: string;
  clarity_version?: string;
}

export class StacksApiClient {
  private static hasWarnedAboutApiKey = false;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(
    network: NetworkName = "mainnet",
    apiKey?: string,
    apiUrl?: string
  ) {
    this.baseUrl = apiUrl || API_URLS[network];
    this.headers = apiKey ? { "x-api-key": apiKey } : {};

    if (!apiKey && !StacksApiClient.hasWarnedAboutApiKey) {
      console.warn(
        "⚠️  No API key provided. You may be rate-limited.\n" +
          "   Set HIRO_API_KEY env var or use --api-key flag.\n" +
          "   Get a free key at: https://platform.hiro.so/"
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

  async getContractInfo(contractId: string): Promise<ContractInfo> {
    const { address, contractName } = parseContractId(contractId);
    const url = `${this.baseUrl}/v2/contracts/interface/${address}/${contractName}`;
    return this.fetchWithErrorHandling<ContractInfo>(url, "Contract", contractId);
  }

  async getContractSource(contractId: string): Promise<string> {
    const { address, contractName } = parseContractId(contractId);
    const url = `${this.baseUrl}/v2/contracts/source/${address}/${contractName}`;
    const data = await this.fetchWithErrorHandling<{ source: string }>(url, "Contract source", contractId);
    return data.source;
  }
}
