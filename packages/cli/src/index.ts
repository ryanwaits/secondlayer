/**
 * @secondlayer/cli
 * CLI tool for generating type-safe Stacks contract interfaces
 */

export { defineConfig } from "./utils/config";
export type {
  SecondLayerConfig,
  ContractSource,
  NetworkName,
} from "./types/config";

export type {
  AbiContract,
  AbiFunction,
  AbiType,
} from "@secondlayer/stacks/clarity";

// Plugin system exports
export type {
  SecondLayerPlugin,
  PluginFactory,
  PluginOptions,
  UserConfig,
  ResolvedConfig,
  GenerateContext,
  PluginContext,
  Logger,
  PluginUtils,
  GeneratedOutput,
  ProcessedContract,
  ContractConfig,
  OutputType,
} from "./types/plugin";

export { PluginManager } from "./core/plugin-manager";
