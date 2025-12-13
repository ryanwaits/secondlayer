/**
 * Plugin Manager for @secondlayer/cli
 * Handles plugin registration, lifecycle execution, and output management
 */

import { format } from "prettier";
import { promises as fs } from "fs";
import path from "path";
import { validateStacksAddress } from "@stacks/transactions";
import type {
  StacksCodegenPlugin,
  UserConfig,
  ResolvedConfig,
  GenerateContext,
  Logger,
  PluginUtils,
  GeneratedOutput,
  ProcessedContract,
  ContractConfig,
  HookResult,
  PluginExecutionContext,
} from "../types/plugin";

/**
 * Core plugin manager that orchestrates plugin execution
 */
export class PluginManager {
  private plugins: StacksCodegenPlugin[] = [];
  private logger: Logger;
  private utils: PluginUtils;
  private executionContext: PluginExecutionContext;

  constructor() {
    this.logger = this.createLogger();
    this.utils = this.createUtils();
    this.executionContext = {
      phase: "config",
      startTime: Date.now(),
      results: new Map(),
    };
  }

  /**
   * Register a plugin
   */
  register(plugin: StacksCodegenPlugin): void {
    // Validate plugin
    if (!plugin.name || !plugin.version) {
      throw new Error("Plugin must have a name and version");
    }

    // Check for duplicate plugin names
    const existing = this.plugins.find((p) => p.name === plugin.name);
    if (existing) {
      throw new Error(
        `Plugin "${plugin.name}" is already registered (version ${existing.version})`
      );
    }

    this.plugins.push(plugin);
    this.logger.debug(`Registered plugin: ${plugin.name}@${plugin.version}`);
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): StacksCodegenPlugin[] {
    return [...this.plugins];
  }

  /**
   * Transform user config through all plugins
   */
  async transformConfig(config: UserConfig): Promise<ResolvedConfig> {
    this.executionContext.phase = "config";
    let transformedConfig = { ...config };

    for (const plugin of this.plugins) {
      if (plugin.transformConfig) {
        this.executionContext.currentPlugin = plugin;
        try {
          const result = await plugin.transformConfig(transformedConfig);
          transformedConfig = result;
          this.recordHookResult(plugin.name, "transformConfig", {
            success: true,
          });
        } catch (error) {
          const err = error as Error;
          this.recordHookResult(plugin.name, "transformConfig", {
            success: false,
            error: err,
          });
          throw new Error(
            `Plugin "${plugin.name}" failed during config transformation: ${err.message}`
          );
        }
      }
    }

    // Add plugins array to resolved config
    const resolvedConfig: ResolvedConfig = {
      ...transformedConfig,
      plugins: this.plugins,
    };

    return resolvedConfig;
  }

  /**
   * Transform contracts through all plugins
   */
  async transformContracts(
    contracts: ContractConfig[],
    _config: ResolvedConfig
  ): Promise<ProcessedContract[]> {
    const processedContracts: ProcessedContract[] = [];

    for (let contract of contracts) {
      // Handle special case for Clarinet plugin contracts
      if ((contract as any)._clarinetSource && contract.abi) {
        // Convert Clarinet contracts directly to ProcessedContract format
        const address =
          typeof contract.address === "string" ? contract.address : "";
        const [contractAddress, contractName] = address.split(".");
        const processed: ProcessedContract = {
          name: contract.name || contractName,
          address: contractAddress,
          contractName: contractName,
          abi: contract.abi,
          source: "local" as const,
          metadata: { source: "clarinet" },
        };
        processedContracts.push(processed);
        continue;
      }

      // Handle direct file mode contracts (already have ABIs parsed)
      if ((contract as any)._directFile && contract.abi) {
        const address =
          typeof contract.address === "string" ? contract.address : "";
        const [contractAddress, contractName] = address.split(".");
        const processed: ProcessedContract = {
          name: contract.name || contractName,
          address: contractAddress,
          contractName: contractName,
          abi: contract.abi,
          source: "local" as const,
          metadata: { source: "direct" },
        };
        processedContracts.push(processed);
        continue;
      }

      // Transform through each plugin
      for (const plugin of this.plugins) {
        if (plugin.transformContract) {
          this.executionContext.currentPlugin = plugin;
          try {
            contract = await plugin.transformContract(contract);
            this.recordHookResult(plugin.name, "transformContract", {
              success: true,
            });
          } catch (error) {
            const err = error as Error;
            this.recordHookResult(plugin.name, "transformContract", {
              success: false,
              error: err,
            });
            this.logger.warn(
              `Plugin "${plugin.name}" failed to transform contract: ${err.message}`
            );
          }
        }
      }

      // Convert to ProcessedContract
      if (contract.abi) {
        const processed: ProcessedContract = {
          name: contract.name || "unknown",
          address:
            typeof contract.address === "string"
              ? contract.address.split(".")[0]
              : "unknown",
          contractName: contract.name || "unknown",
          abi: contract.abi,
          source: "api" as const, // Use "api" as default for plugin-processed contracts
          metadata: contract.metadata,
        };
        processedContracts.push(processed);
      }
    }

    return processedContracts;
  }

  /**
   * Execute lifecycle hooks
   */
  async executeHook(
    hookName: keyof StacksCodegenPlugin,
    context: any
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin[hookName];
      if (typeof hook === "function") {
        this.executionContext.currentPlugin = plugin;
        try {
          await (hook as any).call(plugin, context);
          this.recordHookResult(plugin.name, hookName as string, {
            success: true,
          });
        } catch (error) {
          const err = error as Error;
          this.recordHookResult(plugin.name, hookName as string, {
            success: false,
            error: err,
          });
          this.logger.error(
            `Plugin "${plugin.name}" failed during ${hookName as string}: ${err.message}`
          );
          // Don't throw - allow other plugins to continue
        }
      }
    }
  }

  /**
   * Execute generation phase with full context
   */
  async executeGeneration(
    contracts: ProcessedContract[],
    config: ResolvedConfig
  ): Promise<Map<string, GeneratedOutput>> {
    this.executionContext.phase = "generate";
    const outputs = new Map<string, GeneratedOutput>();

    // Create generation context
    const context: GenerateContext = {
      config,
      logger: this.logger,
      utils: this.utils,
      contracts,
      outputs,
      augment: (outputKey: string, contractName: string, content: any) => {
        this.augmentOutput(outputs, outputKey, contractName, content);
      },
      addOutput: (key: string, output: GeneratedOutput) => {
        outputs.set(key, output);
      },
    };

    // Execute beforeGenerate hooks
    await this.executeHook("beforeGenerate", context);

    // Execute generate hooks
    await this.executeHook("generate", context);

    // Execute afterGenerate hooks
    await this.executeHook("afterGenerate", context);

    return outputs;
  }

  /**
   * Transform outputs through plugins
   */
  async transformOutputs(
    outputs: Map<string, GeneratedOutput>
  ): Promise<Map<string, GeneratedOutput>> {
    this.executionContext.phase = "output";
    const transformedOutputs = new Map<string, GeneratedOutput>();

    for (const [key, output] of outputs) {
      let transformedContent = output.content;

      for (const plugin of this.plugins) {
        if (plugin.transformOutput) {
          this.executionContext.currentPlugin = plugin;
          try {
            transformedContent = await plugin.transformOutput(
              transformedContent,
              output.type || "other"
            );
            this.recordHookResult(plugin.name, "transformOutput", {
              success: true,
            });
          } catch (error) {
            const err = error as Error;
            this.recordHookResult(plugin.name, "transformOutput", {
              success: false,
              error: err,
            });
            this.logger.warn(
              `Plugin "${plugin.name}" failed to transform output: ${err.message}`
            );
          }
        }
      }

      transformedOutputs.set(key, {
        ...output,
        content: transformedContent,
      });
    }

    return transformedOutputs;
  }

  /**
   * Write outputs to disk
   */
  async writeOutputs(outputs: Map<string, GeneratedOutput>): Promise<void> {
    for (const [, output] of outputs) {
      try {
        const resolvedPath = path.resolve(process.cwd(), output.path);
        await this.utils.ensureDir(path.dirname(resolvedPath));
        await this.utils.writeFile(resolvedPath, output.content);
        // Don't log here - let the main command handle success messaging
      } catch (error) {
        const err = error as Error;
        this.logger.error(`Failed to write ${output.path}: ${err.message}`);
        throw err;
      }
    }
  }

  /**
   * Get execution results for debugging
   */
  getExecutionResults(): Map<string, HookResult[]> {
    return new Map(this.executionContext.results);
  }

  /**
   * Augment existing output with additional content
   */
  private augmentOutput(
    outputs: Map<string, GeneratedOutput>,
    outputKey: string,
    contractName: string,
    content: any
  ): void {
    const existing = outputs.get(outputKey);
    if (!existing) {
      this.logger.warn(`Cannot augment non-existent output: ${outputKey}`);
      return;
    }

    // Simple augmentation - append content
    // In a real implementation, this would be more sophisticated
    const augmentedContent = `${existing.content}\n\n// Augmented by plugin for ${contractName}\n${JSON.stringify(content, null, 2)}`;

    outputs.set(outputKey, {
      ...existing,
      content: augmentedContent,
    });
  }

  /**
   * Record hook execution result
   */
  private recordHookResult(
    pluginName: string,
    hookName: string,
    result: Omit<HookResult, "plugin">
  ): void {
    const key = `${pluginName}:${hookName}`;
    const existing = this.executionContext.results.get(key) || [];
    existing.push({ ...result, plugin: pluginName });
    this.executionContext.results.set(key, existing);
  }

  /**
   * Create logger instance
   */
  private createLogger(): Logger {
    return {
      info: (message: string) => console.log(`ℹ️  ${message}`),
      warn: (message: string) => console.warn(`⚠️  ${message}`),
      error: (message: string) => console.error(`❌ ${message}`),
      debug: (message: string) => {
        if (process.env.DEBUG) {
          console.log(`🐛 ${message}`);
        }
      },
      success: (message: string) => console.log(`✅ ${message}`),
    };
  }

  /**
   * Create utils instance
   */
  private createUtils(): PluginUtils {
    return {
      toCamelCase: (str: string) => {
        return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      },

      toKebabCase: (str: string) => {
        return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      },

      validateAddress: (address: string) => {
        return validateStacksAddress(address.split(".")[0]);
      },

      parseContractId: (contractId: string) => {
        const [address, contractName] = contractId.split(".");
        return { address, contractName };
      },

      formatCode: async (code: string) => {
        return format(code, {
          parser: "typescript",
          singleQuote: true,
          semi: true,
          printWidth: 100,
          trailingComma: "es5",
        });
      },

      resolvePath: (relativePath: string) => {
        return path.resolve(process.cwd(), relativePath);
      },

      fileExists: async (filePath: string) => {
        try {
          await fs.access(filePath);
          return true;
        } catch {
          return false;
        }
      },

      readFile: async (filePath: string) => {
        return fs.readFile(filePath, "utf-8");
      },

      writeFile: async (filePath: string, content: string) => {
        await fs.writeFile(filePath, content, "utf-8");
      },

      ensureDir: async (dirPath: string) => {
        await fs.mkdir(dirPath, { recursive: true });
      },
    };
  }
}
