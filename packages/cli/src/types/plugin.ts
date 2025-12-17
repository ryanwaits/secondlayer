/**
 * Plugin system types for @secondlayer/cli
 */

import type { SecondLayerConfig, ResolvedContract, NetworkName } from "./config";

/**
 * Core plugin interface that all plugins must implement
 */
export interface SecondLayerPlugin {
  /** Plugin name (should be unique) */
  name: string;

  /** Plugin version */
  version: string;

  // Lifecycle hooks
  /** Called after config is resolved but before generation starts */
  configResolved?: (config: ResolvedConfig) => void | Promise<void>;

  /** Called before generation starts */
  beforeGenerate?: (context: GenerateContext) => void | Promise<void>;

  /** Called during generation phase - plugins can add their own outputs */
  generate?: (context: GenerateContext) => void | Promise<void>;

  /** Called after all generation is complete */
  afterGenerate?: (context: GenerateContext) => void | Promise<void>;

  // Transform hooks
  /** Transform user config before resolution */
  transformConfig?: (config: UserConfig) => UserConfig | Promise<UserConfig>;

  /** Transform individual contracts during processing */
  transformContract?: (
    contract: ContractConfig
  ) => ContractConfig | Promise<ContractConfig>;

  /** Transform generated output before writing to disk */
  transformOutput?: (
    output: string,
    type: OutputType
  ) => string | Promise<string>;
}

/**
 * User configuration (before plugin transformations)
 */
export type UserConfig = SecondLayerConfig;

/**
 * Resolved configuration (after plugin transformations)
 */
export interface ResolvedConfig extends SecondLayerConfig {
  /** Resolved plugins array */
  plugins: SecondLayerPlugin[];
}

/**
 * Contract configuration that can be transformed by plugins
 */
export interface ContractConfig {
  name?: string;
  address?: string | Partial<Record<NetworkName, string>>;
  source?: string;
  abi?: any;
  metadata?: Record<string, any>;
}

/**
 * Contract config from Clarinet plugin
 */
export interface ClarinetContractConfig extends ContractConfig {
  _clarinetSource: true;
}

/**
 * Contract config from direct file input
 */
export interface DirectFileContractConfig extends ContractConfig {
  _directFile: true;
}

/**
 * Union of all contract config types
 */
export type PluginContractConfig =
  | ContractConfig
  | ClarinetContractConfig
  | DirectFileContractConfig;

/**
 * Type guard for Clarinet contracts
 */
export function isClarinetContract(
  c: ContractConfig
): c is ClarinetContractConfig {
  return "_clarinetSource" in c && c._clarinetSource === true;
}

/**
 * Type guard for direct file contracts
 */
export function isDirectFileContract(
  c: ContractConfig
): c is DirectFileContractConfig {
  return "_directFile" in c && c._directFile === true;
}

/**
 * Processed contract with resolved ABI and metadata
 */
export interface ProcessedContract extends ResolvedContract {
  /** Additional metadata added by plugins */
  metadata?: Record<string, any>;
}

/**
 * Generated output from plugins
 */
export interface GeneratedOutput {
  /** File path where output should be written */
  path: string;

  /** Generated content */
  content: string;

  /** Output type for transformation hooks */
  type?: OutputType;

  /** Whether this output should overwrite existing files */
  overwrite?: boolean;
}

/**
 * Types of outputs that can be generated
 */
export type OutputType =
  | "contracts"
  | "hooks"
  | "actions"
  | "types"
  | "utils"
  | "config"
  | "other";

/**
 * Base context available to all plugin hooks
 */
export interface PluginContext {
  /** Resolved configuration */
  config: ResolvedConfig;

  /** Logger for plugin output */
  logger: Logger;

  /** Utility functions for plugins */
  utils: PluginUtils;
}

/**
 * Context available during generation phase
 */
export interface GenerateContext extends PluginContext {
  /** Processed contracts ready for generation */
  contracts: ProcessedContract[];

  /** Map of output keys to generated content */
  outputs: Map<string, GeneratedOutput>;

  /** Function to augment existing outputs */
  augment: (outputKey: string, contractName: string, content: any) => void;

  /** Function to add new outputs */
  addOutput: (key: string, output: GeneratedOutput) => void;
}

/**
 * Logger interface for plugin output
 */
export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
  success: (message: string) => void;
}

/**
 * Utility functions available to plugins
 */
export interface PluginUtils {
  /** Convert kebab-case to camelCase */
  toCamelCase: (str: string) => string;

  /** Convert camelCase to kebab-case */
  toKebabCase: (str: string) => string;

  /** Validate Stacks address format */
  validateAddress: (address: string) => boolean;

  /** Parse contract identifier (address.contract-name) */
  parseContractId: (contractId: string) => {
    address: string;
    contractName: string;
  };

  /** Format TypeScript code using prettier */
  formatCode: (code: string) => Promise<string>;

  /** Resolve file path relative to project root */
  resolvePath: (relativePath: string) => string;

  /** Check if file exists */
  fileExists: (path: string) => Promise<boolean>;

  /** Read file content */
  readFile: (path: string) => Promise<string>;

  /** Write file content */
  writeFile: (path: string, content: string) => Promise<void>;

  /** Create directory recursively */
  ensureDir: (path: string) => Promise<void>;
}

/**
 * Plugin factory function type for creating plugins with options
 */
export type PluginFactory<TOptions = any> = (
  options?: TOptions
) => SecondLayerPlugin;

/**
 * Plugin options base interface
 */
export interface PluginOptions {
  /** Include only specific contracts/functions */
  include?: string[];

  /** Exclude specific contracts/functions */
  exclude?: string[];

  /** Enable debug output */
  debug?: boolean;
}

/**
 * Hook execution result
 */
export interface HookResult<T = any> {
  /** Whether the hook was successful */
  success: boolean;

  /** Result data from the hook */
  data?: T;

  /** Error if hook failed */
  error?: Error;

  /** Plugin that executed the hook */
  plugin: string;
}

/**
 * Plugin execution context for internal use
 */
export interface PluginExecutionContext {
  /** Current plugin being executed */
  currentPlugin?: SecondLayerPlugin;

  /** Execution phase */
  phase: "config" | "generate" | "output";

  /** Start time for performance tracking */
  startTime: number;

  /** Plugin execution results */
  results: Map<string, HookResult[]>;
}
