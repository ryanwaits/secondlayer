/**
 * Configuration types for @secondlayer/cli
 */

import type { AbiContract } from "@secondlayer/stacks/clarity";
import type { ClarinetOptions } from "../plugins/clarinet/index";

/** Supported Stacks network identifiers for contract resolution. */
export type NetworkName = "mainnet" | "testnet" | "devnet";

/** Specifies a contract to generate typed interfaces for, either from a deployed address or local Clarity source file. */
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

	/**
	 * Pre-resolved ABI (from Clarinet simnet or direct input)
	 */
	abi?: AbiContract;
}

/** Configuration for the `@secondlayer/cli` code generator. */
export interface SecondLayerConfig {
	/**
	 * Contracts to generate interfaces for (optional — Clarinet can provide these)
	 */
	contracts?: ContractSource[];

	/**
	 * Output file path
	 */
	out: string;

	/**
	 * Load contracts from a local Clarinet project via simnet.
	 * `true` uses defaults; pass options for path / include / exclude / requirements.
	 * Skips silently when Clarinet.toml is missing.
	 */
	clarinet?: boolean | ClarinetOptions;

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

export type { ClarinetOptions };
