/**
 * Clarinet Plugin for @secondlayer/cli
 * Generates type-safe contract interfaces from local Clarity contracts using Clarinet SDK
 */

import { initSimnet } from "@hirosystems/clarinet-sdk";
import { toCamelCase } from "@secondlayer/clarity-types";
import { generateContractInterface } from "../../generators/contract";
import type {
  PluginFactory,
  UserConfig,
  GenerateContext,
} from "../../types/plugin";

export interface ClarinetPluginOptions {
  /** Path to Clarinet.toml file */
  path?: string;

  /** Include only specific contracts */
  include?: string[];

  /** Exclude specific contracts */
  exclude?: string[];

  /** Enable debug output */
  debug?: boolean;
}

/**
 * Sanitize contract name to be a valid JavaScript identifier using camelCase
 */
function sanitizeContractName(name: string): string {
  return toCamelCase(name);
}

/**
 * Check if a contract is a user-defined contract (not a system contract)
 */
async function isUserDefinedContract(
  contractId: string,
  manifestPath: string
): Promise<boolean> {
  const [address, contractName] = contractId.split(".");

  try {
    // Read Clarinet.toml to get user-defined contracts
    const { promises: fs } = await import("fs");
    const tomlContent = await fs.readFile(manifestPath, "utf-8");

    // Simple TOML parsing to find [contracts.CONTRACT_NAME] sections
    const contractSectionRegex = /^\[contracts\.([^\]]+)\]/gm;
    const userContracts = new Set<string>();

    let match;
    while ((match = contractSectionRegex.exec(tomlContent)) !== null) {
      userContracts.add(match[1]);
    }

    // If the contract is explicitly defined in Clarinet.toml, it's user-defined
    if (userContracts.has(contractName)) {
      return true;
    }
  } catch (error) {
    // If we can't read the TOML file, fall back to pattern matching
  }

  // Fallback: System contracts typically have specific addresses or are in the boot contracts
  // Common system contract patterns:
  const systemContractPatterns = [
    /^pox-\d+$/, // pox-2, pox-3, etc.
    /^bns$/, // Blockchain Name System
    /^costs-\d+$/, // costs-2, costs-3, etc.
    /^lockup$/, // lockup contract
  ];

  // Check if it matches any system contract pattern
  if (systemContractPatterns.some((pattern) => pattern.test(contractName))) {
    return false;
  }

  // System contracts often use specific addresses
  const systemAddresses = [
    "SP000000000000000000002Q6VF78", // Boot contracts address
    "ST000000000000000000002AMW42H", // Boot contracts address (testnet)
  ];

  if (systemAddresses.includes(address)) {
    return false;
  }

  return true;
}

/**
 * Clarinet plugin factory
 */
export const clarinet: PluginFactory<ClarinetPluginOptions> = (
  options = {}
) => {
  const manifestPath = options.path || "./Clarinet.toml";
  let simnet: any;

  return {
    name: "@secondlayer/cli/plugin-clarinet",
    version: "1.0.0",

    async transformConfig(config: UserConfig): Promise<UserConfig> {
      try {
        // Initialize simnet to extract contract ABIs
        simnet = await initSimnet(manifestPath);

        // Get contract interfaces from Clarinet
        const contractInterfaces = simnet.getContractsInterfaces();
        const contracts = [];

        for (const [contractId, abi] of contractInterfaces) {
          const [_, contractName] = contractId.split(".");

          // Skip system contracts
          if (!(await isUserDefinedContract(contractId, manifestPath))) {
            if (options.debug) {
              console.log(`🚫 Skipping system contract: ${contractId}`);
            }
            continue;
          }

          // Apply user filters
          if (options.include && !options.include.includes(contractName)) {
            continue;
          }
          if (options.exclude && options.exclude.includes(contractName)) {
            continue;
          }

          // Sanitize the contract name for JavaScript export
          const sanitizedName = sanitizeContractName(contractName);

          // Don't set source field to avoid conflict with file resolution
          // Instead, we'll track this in metadata during processing
          contracts.push({
            name: sanitizedName,
            address: contractId,
            abi: abi,
            // Remove source field - this was causing the path resolution issue
            _clarinetSource: true, // Internal flag for our plugin
          });
        }

        if (options.debug) {
          console.log(
            `🔍 Clarinet plugin found ${contracts.length} user-defined contracts`
          );
        }

        return {
          ...config,
          contracts: [...(config.contracts || []), ...contracts],
        };
      } catch (error) {
        const err = error as Error;
        if (options.debug) {
          console.warn(
            `⚠️  Clarinet plugin failed to load contracts: ${err.message}`
          );
        }
        // If Clarinet.toml doesn't exist or fails, just return config unchanged
        return config;
      }
    },

    async generate(context: GenerateContext): Promise<void> {
      // Filter contracts that came from Clarinet
      const clarinetContracts = context.contracts.filter(
        (contract) => contract.metadata?.source === "clarinet"
      );

      if (clarinetContracts.length === 0) {
        return;
      }

      if (options.debug) {
        context.logger.debug(
          `Generating interfaces for ${clarinetContracts.length} Clarinet contracts`
        );
      }

      // Generate the main contracts file using existing generator
      const contractsCode = await generateContractInterface(clarinetContracts);

      context.addOutput("contracts", {
        path: context.config.out,
        content: contractsCode,
        type: "contracts",
      });

      // Don't log success here - let the main command handle it
    },
  };
};

/**
 * Utility function to check if a Clarinet project exists
 */
export async function hasClarinetProject(
  path = "./Clarinet.toml"
): Promise<boolean> {
  try {
    const { promises: fs } = await import("fs");
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
