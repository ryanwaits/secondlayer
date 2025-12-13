import got from "got";
import type { NetworkName } from "../types/config";

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
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(
    network: NetworkName = "mainnet",
    apiKey?: string,
    apiUrl?: string
  ) {
    this.baseUrl = apiUrl || API_URLS[network];
    this.headers = apiKey ? { "x-api-key": apiKey } : {};
  }

  async getContractInfo(contractId: string): Promise<ContractInfo> {
    const [address, contractName] = contractId.split(".");

    if (!address || !contractName) {
      throw new Error(
        `Invalid contract ID format: ${contractId}. Expected format: ADDRESS.CONTRACT_NAME`
      );
    }

    const url = `${this.baseUrl}/v2/contracts/interface/${address}/${contractName}`;

    try {
      const response = await got(url, {
        headers: this.headers,
        responseType: "json",
      });

      return response.body as ContractInfo;
    } catch (error: any) {
      if (error.response?.statusCode === 404) {
        throw new Error(`Contract not found: ${contractId}`);
      }
      if (error.response?.statusCode === 429) {
        throw new Error(
          "Rate limited. Please provide an API key in your config."
        );
      }
      throw new Error(`Failed to fetch contract: ${error.message}`);
    }
  }

  async getContractSource(contractId: string): Promise<string> {
    const [address, contractName] = contractId.split(".");

    if (!address || !contractName) {
      throw new Error(
        `Invalid contract ID format: ${contractId}. Expected format: ADDRESS.CONTRACT_NAME`
      );
    }

    const url = `${this.baseUrl}/v2/contracts/source/${address}/${contractName}`;

    try {
      const response = await got(url, {
        headers: this.headers,
        responseType: "json",
      });

      const data = response.body as { source: string };
      return data.source;
    } catch (error: any) {
      return "";
    }
  }
}
