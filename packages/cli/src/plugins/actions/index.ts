/**
 * Actions Plugin for @secondlayer/cli
 * Generates read and write helper functions for direct blockchain interaction
 */

import { generateActionHelpers } from "./generators";
import type {
  PluginFactory,
  // UserConfig,
  GenerateContext,
} from "../../types/plugin";

export interface ActionsPluginOptions {
  /** Include only specific contracts */
  include?: string[];

  /** Exclude specific contracts */
  exclude?: string[];

  /** Include only specific functions */
  includeFunctions?: string[];

  /** Exclude specific functions */
  excludeFunctions?: string[];

  /** Enable debug output */
  debug?: boolean;
}

/**
 * Actions plugin factory
 */
export const actions: PluginFactory<ActionsPluginOptions> = (options = {}) => {
  return {
    name: "@secondlayer/cli/plugin-actions",
    version: "1.0.0",

    async generate(context: GenerateContext): Promise<void> {
      const { contracts } = context;

      // Filter contracts based on options
      const filteredContracts = contracts.filter((contract) => {
        if (options.include && !options.include.includes(contract.name)) {
          return false;
        }
        if (options.exclude && options.exclude.includes(contract.name)) {
          return false;
        }
        return true;
      });

      if (filteredContracts.length === 0) {
        if (options.debug) {
          context.logger.debug("Actions plugin: No contracts to process");
        }
        return;
      }

      if (options.debug) {
        context.logger.debug(
          `Actions plugin: Generating read/write helpers for ${filteredContracts.length} contracts`
        );
      }

      // Collect all helpers for all contracts
      const contractHelpers = new Map<string, string>();

      for (const contract of filteredContracts) {
        const actionsCode = await generateActionHelpers(contract, options);
        if (actionsCode) {
          contractHelpers.set(contract.name, actionsCode);
        }
      }

      // Inject all helpers into the output
      if (contractHelpers.size > 0) {
        const existingOutput = context.outputs.get("contracts");
        if (existingOutput) {
          let modifiedContent = addRequiredImports(existingOutput.content);

          // Inject helpers for each contract
          for (const [contractName, helpersCode] of contractHelpers) {
            modifiedContent = injectHelpersIntoContract(
              modifiedContent,
              contractName,
              helpersCode
            );
          }

          context.outputs.set("contracts", {
            ...existingOutput,
            content: modifiedContent,
          });
        }
      }
    },
  };
};

/**
 * Add required imports for fetchCallReadOnlyFunction and makeContractCall
 */
function addRequiredImports(content: string): string {
  // Check if imports already exist
  if (
    content.includes("fetchCallReadOnlyFunction") &&
    content.includes("makeContractCall")
  ) {
    return content;
  }

  // Find the existing @stacks/transactions import line
  const transactionsImportRegex =
    /import\s+\{([^}]+)\}\s+from\s+['"]@stacks\/transactions['"];/;
  const match = content.match(transactionsImportRegex);

  if (match) {
    // Add the new imports to the existing import
    const existingImports = match[1].trim();
    const newImports = ["fetchCallReadOnlyFunction", "makeContractCall"]
      .filter((imp) => !existingImports.includes(imp))
      .join(", ");

    if (newImports) {
      const updatedImport = `import { ${existingImports}, ${newImports} } from '@stacks/transactions';`;
      return content.replace(transactionsImportRegex, updatedImport);
    }
  }

  return content;
}

/**
 * Inject read/write helpers into a specific contract object in the output
 */
function injectHelpersIntoContract(
  content: string,
  contractName: string,
  helpersCode: string
): string {
  // Use a more precise regex to find the entire contract object
  const contractPattern = new RegExp(
    `(export const ${contractName} = \\{[\\s\\S]*?)\\n\\} as const;`,
    "g"
  );

  return content.replace(contractPattern, (_, contractBody) => {
    // Remove any trailing comma and whitespace from the contract body
    const cleanBody = contractBody.replace(/,\s*$/, "");

    // Add proper indentation to lines that start top-level properties
    const indentedHelpersCode = helpersCode
      .split("\n")
      .map((line) => {
        // Only add indentation to lines that start with a property name (like "write:")
        if (line.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*\s*:/)) {
          return `  ${line}`;
        }
        return line;
      })
      .join("\n");

    // Add the helpers with proper formatting
    return `${cleanBody},

${indentedHelpersCode}
} as const;`;
  });
}
