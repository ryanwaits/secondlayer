/**
 * Configuration types for @secondlayer/cli
 */

import type { AbiContract } from "@secondlayer/stacks/clarity";

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

export interface SecondLayerConfig {
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

  /**
   * Default deployer address for local contracts without explicit addresses
   * Defaults to ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM (devnet default)
   */
  defaultAddress?: string;
}

export interface ResolvedContract {
  name: string;
  address: string;
  contractName: string;
  abi: AbiContract;
  source: "api" | "local";
}

// Helper function type
export type ConfigDefiner = (config: SecondLayerConfig) => SecondLayerConfig;
