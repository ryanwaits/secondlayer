/**
 * @secondlayer/cli
 * CLI tool for generating type-safe Stacks contract interfaces
 */

export { defineConfig } from "./utils/config";
export type {
	SecondLayerConfig,
	ContractSource,
	NetworkName,
	ClarinetOptions,
} from "./types/config";

export type {
	AbiContract,
	AbiFunction,
	AbiType,
} from "@secondlayer/stacks/clarity";
