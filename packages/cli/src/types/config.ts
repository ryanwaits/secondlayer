/**
 * Configuration types for @secondlayer/cli
 */

export type NetworkName = "mainnet" | "testnet" | "devnet";

export interface ContractSource {
  /**
   * Contract identifier (address.name) for deployed contracts
   */
  address?: string | Partial<Record<NetworkName, string>>;

  /**
   * Path to local Clarity file
   */
  source?: string;

  /**
   * Optional name to use in generated code
   */
  name?: string;
}

export interface StacksConfig {
  /**
   * Contracts to generate interfaces for (optional - plugins can provide these)
   */
  contracts?: ContractSource[];

  /**
   * Output file path
   */
  out: string;

  /**
   * Plugins to use for generation
   */
  plugins?: any[]; // Will be properly typed when plugins are imported

  /**
   * Network to use for fetching contracts
   */
  network?: NetworkName;

  /**
   * API key for Stacks API (if required)
   */
  apiKey?: string;

  /**
   * Base URL for Stacks API (optional override)
   */
  apiUrl?: string;
}

export interface ResolvedContract {
  name: string;
  address: string;
  contractName: string;
  abi: any; // Will be ClarityContract type
  source: "api" | "local";
}

// Helper function type
export type ConfigDefiner = (config: StacksConfig) => StacksConfig;
