/**
 * @secondlayer/cli
 * CLI tool for generating type-safe Stacks contract interfaces
 */

export { defineConfig } from "./utils/config";
export type {
  StacksConfig,
  ContractSource,
  NetworkName,
} from "./types/config";

export type {
  ClarityContract,
  ClarityFunction,
  ClarityType,
  ContractCallParams,
  ReadOnlyCallParams,
} from "@secondlayer/clarity-types";

// Plugin system exports
export type {
  StacksCodegenPlugin,
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
