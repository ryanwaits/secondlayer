import { promises as fs } from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import { Glob } from "bun";
import { loadConfig } from "../utils/config";
import { StacksApiClient } from "../utils/api";
import { parseClarityFile, parseApiResponse } from "../parsers/clarity";
import { generateContractInterface } from "../generators/contract";
import { PluginManager } from "../core/plugin-manager";
import type {
  ResolvedContract,
  NetworkName,
  ContractSource,
  StacksConfig,
} from "../types/config";
import type {
  ResolvedConfig,
  ProcessedContract,
  ContractConfig,
} from "../types/plugin";

/**
 * Generate command implementation
 */

export interface GenerateOptions {
  config?: string;
  out?: string;
  apiKey?: string;
  watch?: boolean;
}

/**
 * Check if a string looks like a deployed contract address (ADDRESS.contract-name)
 */
function isContractAddress(input: string): boolean {
  // Contract addresses are in format: SP/ST/SM/SN...ADDRESS.contract-name
  // SP = mainnet standard, ST = testnet standard
  // SM = mainnet multisig, SN = testnet multisig
  const contractIdPattern = /^(SP|ST|SM|SN)[A-Z0-9]{38,}\.[a-zA-Z][a-zA-Z0-9-]*$/;
  return contractIdPattern.test(input);
}

/**
 * Infer network from contract address prefix
 */
function inferNetwork(address: string): NetworkName {
  // SP = mainnet standard, SM = mainnet multisig
  if (address.startsWith("SP") || address.startsWith("SM")) {
    return "mainnet";
  }
  // ST = testnet standard, SN = testnet multisig
  return "testnet";
}

/**
 * Parse inputs and separate into local files and deployed contract addresses
 */
interface ParsedInputs {
  files: string[];
  contractIds: string[];
}

async function parseInputs(inputs: string[]): Promise<ParsedInputs> {
  const files: string[] = [];
  const contractIds: string[] = [];

  for (const input of inputs) {
    // Check if it's a deployed contract address
    if (isContractAddress(input)) {
      contractIds.push(input);
      continue;
    }

    // Check if it's a glob pattern
    if (input.includes("*") || input.includes("?")) {
      const glob = new Glob(input);
      for await (const file of glob.scan({ cwd: process.cwd(), absolute: true })) {
        if (file.endsWith(".clar")) {
          files.push(file);
        }
      }
      continue;
    }

    // Direct file path
    if (input.endsWith(".clar")) {
      const absolutePath = path.resolve(process.cwd(), input);
      files.push(absolutePath);
    }
  }

  return {
    files: [...new Set(files)],
    contractIds: [...new Set(contractIds)],
  };
}

/**
 * Convert filename to camelCase contract name
 */
function deriveContractName(filePath: string): string {
  const basename = path.basename(filePath, ".clar");
  // Convert kebab-case or snake_case to camelCase
  return basename
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^(.)/, (_, char) => char.toLowerCase())
    .replace(/^\d/, "_$&"); // Prefix with underscore if starts with digit
}

/**
 * Convert contract name from kebab-case to camelCase
 */
function toCamelCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^(.)/, (_, char) => char.toLowerCase())
    .replace(/^\d/, "_$&");
}

/**
 * Build config from direct inputs (local files and/or deployed contract addresses)
 */
async function buildConfigFromInputs(
  parsedInputs: ParsedInputs,
  outPath: string,
  apiKey: string | undefined,
  spinner: ReturnType<typeof ora>
): Promise<StacksConfig> {
  const contracts = [];

  // Process local .clar files
  for (const file of parsedInputs.files) {
    const abi = await parseClarityFile(file);
    const name = deriveContractName(file);

    contracts.push({
      name,
      address: `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.${name}`,
      abi,
      _directFile: true,
    });
  }

  // Process deployed contract addresses (fetch from API)
  for (const contractId of parsedInputs.contractIds) {
    const [address, contractName] = contractId.split(".");
    const network = inferNetwork(address);

    spinner.text = `Fetching ${contractName} from ${network}...`;

    try {
      const apiClient = new StacksApiClient(network, apiKey);
      const contractInfo = await apiClient.getContractInfo(contractId);
      const abi = parseApiResponse(contractInfo);
      const name = toCamelCase(contractName);

      contracts.push({
        name,
        address: contractId,
        abi,
        _directFile: true,
      });
    } catch (error: any) {
      throw new Error(`Failed to fetch contract ${contractId}: ${error.message}`);
    }
  }

  return {
    out: outPath,
    contracts,
    plugins: [],
  };
}

export async function generate(files: string[], options: GenerateOptions) {
  const spinner = ora("Processing contracts").start();

  try {
    let config: StacksConfig;

    // Check if direct inputs were provided (files or contract addresses)
    if (files && files.length > 0) {
      // Require -o/--out when using direct inputs
      if (!options.out) {
        spinner.fail("Output path required");
        console.error(
          chalk.red("\nWhen using direct inputs, you must specify an output path with -o/--out")
        );
        console.log(chalk.gray("\nExamples:"));
        console.log(chalk.gray("  secondlayer generate ./contracts/*.clar -o ./src/generated.ts"));
        console.log(chalk.gray("  secondlayer generate SP2C2YFP12AJZB1M6DY7SF9A3PRHWKGYGVWQKW3.my-token -o ./src/generated.ts"));
        process.exit(1);
      }

      // Parse inputs to separate files from contract addresses
      const parsedInputs = await parseInputs(files);
      const totalInputs = parsedInputs.files.length + parsedInputs.contractIds.length;

      if (totalInputs === 0) {
        spinner.fail("No valid inputs found");
        console.error(chalk.red("\nNo .clar files or contract addresses matched the provided inputs"));
        process.exit(1);
      }

      spinner.text = `Processing ${totalInputs} contract(s)...`;

      // Get API key from option or environment variable
      const apiKey = options.apiKey || process.env.HIRO_API_KEY;

      config = await buildConfigFromInputs(parsedInputs, options.out, apiKey, spinner);
    } else {
      // Use config file (existing behavior)
      config = await loadConfig(options.config);
    }

    // Get plugin manager from config loading
    const pluginManager = new PluginManager();

    // Register plugins from config
    if (config.plugins) {
      for (const plugin of config.plugins) {
        pluginManager.register(plugin);
      }
    }

    // Execute configResolved hooks
    await pluginManager.executeHook("configResolved", config);

    // Convert existing contracts to ContractConfig format (if any)
    // Use the resolved config which includes contracts added by plugins
    const contractConfigs: ContractConfig[] = (config.contracts || []).map(
      (contract) => ({
        name: contract.name,
        address: contract.address,
        source: contract.source,
        abi: (contract as any).abi, // Include ABI if it exists (from plugins)
        _clarinetSource: (contract as any)._clarinetSource, // Include plugin flags
      })
    );

    // Transform contracts through plugins (plugins can add more contracts)
    const processedContracts = await pluginManager.transformContracts(
      contractConfigs,
      config
    );

    if (processedContracts.length === 0) {
      spinner.warn("No contracts found to generate");
      console.log("\nTo get started:");
      console.log("  • Add contracts to your config file, or");
      console.log("  • Use plugins like clarinet() for local contracts");
      return;
    }

    // Execute generation through plugin system
    const outputs = await pluginManager.executeGeneration(
      processedContracts,
      config
    );

    // If no plugins generated the main contracts output, generate it using the existing generator
    if (!outputs.has("contracts") && processedContracts.length > 0) {
      const contractsCode = await generateContractInterface(processedContracts);
      outputs.set("contracts", {
        path: config.out,
        content: contractsCode,
        type: "contracts",
      });
    }

    // Transform outputs through plugins
    const transformedOutputs = await pluginManager.transformOutputs(outputs);

    // Write all outputs to disk
    await pluginManager.writeOutputs(transformedOutputs);

    const contractCount = processedContracts.length;
    const contractWord = contractCount === 1 ? "contract" : "contracts";
    spinner.succeed(`Generation complete for ${contractCount} ${contractWord}`);

    console.log(`\n📄 ${config.out}`);
    console.log(`\n💡 Import your contracts:`);

    // Show import examples based on actual contract names
    if (processedContracts.length > 0) {
      const exampleContract = processedContracts[0];
      console.log(
        chalk.gray(
          `   import { ${exampleContract.name} } from '${config.out.replace(/\.ts$/, "")}'`
        )
      );

      if (processedContracts.length > 1) {
        console.log(
          chalk.gray(
            `   // Also available: ${processedContracts
              .slice(1)
              .map((c) => c.name)
              .join(", ")}`
          )
        );
      }
    }
  } catch (error: any) {
    spinner.fail("Generation failed");
    console.error(chalk.red(`\n${error.message}`));
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Keep existing contract resolution functions for backward compatibility and plugin use
export async function resolveContract(
  source: ContractSource,
  network: NetworkName,
  apiKey?: string,
  apiUrl?: string
): Promise<ResolvedContract> {
  // Handle local source files
  if (source.source) {
    const filePath = path.resolve(process.cwd(), source.source);
    const abi = await parseClarityFile(filePath);

    const name =
      source.name ||
      path
        .basename(source.source, ".clar")
        .replace(/-/g, "_")
        .replace(/^\d/, "_$&");

    // For local files, we need to construct the address
    const address =
      typeof source.address === "string"
        ? source.address
        : source.address?.[network] ||
          "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";

    const [contractAddress, contractName] = address.includes(".")
      ? address.split(".")
      : [address, name];

    return {
      name,
      address: contractAddress,
      contractName: contractName || name,
      abi,
      source: "local",
    };
  }

  // Handle deployed contracts
  if (source.address) {
    const contractId =
      typeof source.address === "string"
        ? source.address
        : source.address[network];

    if (!contractId) {
      throw new Error(`No contract address for network ${network}`);
    }

    const contractInfo = await new StacksApiClient(
      network,
      apiKey,
      apiUrl
    ).getContractInfo(contractId);
    const abi = parseApiResponse(contractInfo);

    const [contractAddress, contractName] = contractId.split(".");
    const name =
      source.name || contractName.replace(/-/g, "_").replace(/^\d/, "_$&");

    return {
      name,
      address: contractAddress,
      contractName,
      abi,
      source: "api",
    };
  }

  throw new Error("Contract must have either address or source");
}

export async function resolveContracts(
  source: ContractSource,
  defaultNetwork: NetworkName | undefined,
  apiKey?: string,
  apiUrl?: string
): Promise<ResolvedContract[]> {
  // Handle single network contracts (existing behavior)
  if (typeof source.address === "string" || source.source) {
    const resolved = await resolveContract(
      source,
      defaultNetwork || "testnet", // Use testnet as fallback for single contracts
      apiKey,
      apiUrl
    );
    return [resolved];
  }

  // Handle multi-network contracts
  if (source.address && typeof source.address === "object") {
    const resolvedContracts: ResolvedContract[] = [];

    // If defaultNetwork is specified, only generate that network
    // If no network specified, generate all networks defined in the address object
    const networksToGenerate = defaultNetwork
      ? [defaultNetwork].filter(
          (net) => (source.address as Partial<Record<NetworkName, string>>)[net]
        ) // Only if address exists for that network
      : (Object.keys(source.address) as NetworkName[]);

    for (const network of networksToGenerate) {
      const contractId = source.address[network];
      if (!contractId) continue;

      try {
        const networkApiClient = new StacksApiClient(network, apiKey, apiUrl);

        const contractInfo = await networkApiClient.getContractInfo(contractId);
        const abi = parseApiResponse(contractInfo);

        const [contractAddress, contractName] = contractId.split(".");
        const baseName =
          source.name || contractName.replace(/-/g, "_").replace(/^\d/, "_$&");

        // Generate network-specific names
        const name =
          network === "mainnet"
            ? baseName
            : `${network}${baseName.charAt(0).toUpperCase() + baseName.slice(1)}`;

        resolvedContracts.push({
          name,
          address: contractAddress,
          contractName,
          abi,
          source: "api",
        });
      } catch (error: any) {
        console.warn(
          `Warning: Failed to resolve contract for ${network}: ${error.message}`
        );
      }
    }

    return resolvedContracts;
  }

  throw new Error("Contract must have either address or source");
}
