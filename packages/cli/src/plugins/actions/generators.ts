/**
 * Action generators for read and write helper functions
 */

import type { ProcessedContract } from "../../types/plugin";
import { toCamelCase, type AbiFunction } from "@secondlayer/stacks/clarity";
import type { ActionsPluginOptions } from "./index";
import { generateArgsSignature, generateClarityArgs } from "../../utils/generator-helpers";


/**
 * Generate read helper functions for a contract (fixed version)
 */
function generateReadHelpers(
  contract: ProcessedContract,
  options: ActionsPluginOptions
): string {
  const { abi } = contract;
  const functions = abi.functions || [];

  const readOnlyFunctions = functions.filter(
    (f: AbiFunction) =>
      f.access === "read-only"
  );

  if (readOnlyFunctions.length === 0) {
    return "";
  }

  // Apply function filters
  const filteredFunctions = readOnlyFunctions.filter(
    (func: AbiFunction) => {
      if (
        options.includeFunctions &&
        !options.includeFunctions.includes(func.name)
      ) {
        return false;
      }
      if (
        options.excludeFunctions &&
        options.excludeFunctions.includes(func.name)
      ) {
        return false;
      }
      return true;
    }
  );

  if (filteredFunctions.length === 0) {
    return "";
  }

  const helpers = filteredFunctions.map((func: AbiFunction) => {
    const methodName = toCamelCase(func.name);
    const argsSignature = generateArgsSignature(func.args);
    const clarityArgs = generateClarityArgs(func.args);

    return `async ${methodName}(${argsSignature}options?: {
      network?: 'mainnet' | 'testnet' | 'devnet';
      senderAddress?: string;
    }) {
      return await fetchCallReadOnlyFunction({
        contractAddress: '${contract.address}',
        contractName: '${contract.contractName}',
        functionName: '${func.name}',
        functionArgs: [${clarityArgs}],
        network: options?.network ?? inferNetworkFromAddress('${contract.address}') ?? 'mainnet',
        senderAddress: options?.senderAddress || 'SP000000000000000000002Q6VF78'
      });
    }`;
  });

  return `read: {
    ${helpers.join(",\n\n    ")}
  }`;
}

/**
 * Generate write helper functions for a contract (fixed version)
 */
function generateWriteHelpers(
  contract: ProcessedContract,
  options: ActionsPluginOptions
): string {
  const { abi } = contract;
  const functions = abi.functions || [];
  const envVarName = options.senderKeyEnv ?? "STX_SENDER_KEY";

  const publicFunctions = functions.filter(
    (f: AbiFunction) => f.access === "public"
  );

  if (publicFunctions.length === 0) {
    return "";
  }

  // Apply function filters
  const filteredFunctions = publicFunctions.filter((func: AbiFunction) => {
    if (
      options.includeFunctions &&
      !options.includeFunctions.includes(func.name)
    ) {
      return false;
    }
    if (
      options.excludeFunctions &&
      options.excludeFunctions.includes(func.name)
    ) {
      return false;
    }
    return true;
  });

  if (filteredFunctions.length === 0) {
    return "";
  }

  const helpers = filteredFunctions.map((func: AbiFunction) => {
    const methodName = toCamelCase(func.name);
    const argsSignature = generateArgsSignature(func.args);
    const clarityArgs = generateClarityArgs(func.args);

    return `async ${methodName}(${argsSignature}senderKey?: string, options?: {
      network?: 'mainnet' | 'testnet' | 'devnet';
      fee?: string | number | undefined;
      nonce?: bigint;
      anchorMode?: 1 | 2 | 3; // AnchorMode: OnChainOnly = 1, OffChainOnly = 2, Any = 3
      postConditions?: PostCondition[];
      validateWithAbi?: boolean;
    }) {
      const resolvedSenderKey = senderKey ?? process.env.${envVarName};
      if (!resolvedSenderKey) {
        throw new Error('senderKey required: pass as argument or set ${envVarName} env var');
      }
      const { network = 'mainnet', ...txOptions } = options ?? {};

      return await makeContractCall({
        contractAddress: '${contract.address}',
        contractName: '${contract.contractName}',
        functionName: '${func.name}',
        functionArgs: [${clarityArgs}],
        senderKey: resolvedSenderKey,
        network,
        validateWithAbi: true,
        ...txOptions
      });
    }`;
  });

  return `write: {
    ${helpers.join(",\n\n    ")}
  }`;
}

/**
 * Generate action helpers (read and write functions) for a contract
 */
export async function generateActionHelpers(
  contract: ProcessedContract,
  options: ActionsPluginOptions
): Promise<string> {
  const readHelpers = generateReadHelpers(contract, options);
  const writeHelpers = generateWriteHelpers(contract, options);

  if (!readHelpers && !writeHelpers) {
    return "";
  }

  const helpers = [readHelpers, writeHelpers].filter(Boolean);
  return helpers.join(",\n\n");
}
