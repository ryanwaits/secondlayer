/**
 * Code generators for the testing plugin
 * Generates type-safe helpers for Clarinet SDK unit tests
 */

import type { ProcessedContract } from "../../types/plugin";
import {
  toCamelCase,
  isAbiTuple,
  type AbiFunction,
  type AbiMap,
  type AbiType,
  type AbiVariable,
} from "@secondlayer/stacks/clarity";
import type { TestingPluginOptions } from "./index";
import { getTypeForArg } from "../../utils/type-mapping";
import { generateClarityConversion } from "../../utils/clarity-conversion";
import { generateArgsSignature, generateClarityArgs } from "../../utils/generator-helpers";

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}


/**
 * Generate a public function helper
 */
function generatePublicFunction(
  func: AbiFunction,
  contractId: string
): string {
  const methodName = toCamelCase(func.name);
  const argsSignature = generateArgsSignature(func.args);
  const clarityArgs = generateClarityArgs(func.args);

  return `${methodName}: (${argsSignature}caller: string) => {
      const callerAddr = accounts.get(caller) ?? caller;
      return simnet.callPublicFn(
        '${contractId}',
        '${func.name}',
        [${clarityArgs}],
        callerAddr
      );
    }`;
}

/**
 * Generate a read-only function helper
 */
function generateReadOnlyFunction(
  func: AbiFunction,
  contractId: string
): string {
  const methodName = toCamelCase(func.name);
  const argsSignature = generateArgsSignature(func.args);
  const clarityArgs = generateClarityArgs(func.args);

  // Read-only functions don't need a caller, use deployer as default
  const hasArgs = func.args.length > 0;
  const argsParam = hasArgs ? argsSignature : "";

  return `${methodName}: (${argsParam}) => {
      return simnet.callReadOnlyFn(
        '${contractId}',
        '${func.name}',
        [${clarityArgs}],
        accounts.get('deployer')!
      );
    }`;
}

/**
 * Generate a private function helper (for testing only)
 */
function generatePrivateFunction(
  func: AbiFunction,
  contractId: string
): string {
  const methodName = toCamelCase(func.name);
  const argsSignature = generateArgsSignature(func.args);
  const clarityArgs = generateClarityArgs(func.args);

  return `${methodName}: (${argsSignature}caller: string) => {
      const callerAddr = accounts.get(caller) ?? caller;
      return simnet.callPrivateFn(
        '${contractId}',
        '${func.name}',
        [${clarityArgs}],
        callerAddr
      );
    }`;
}

/**
 * Generate a data variable accessor helper
 */
function generateDataVarHelper(
  variable: AbiVariable,
  contractId: string
): string {
  const methodName = toCamelCase(variable.name);

  return `${methodName}: () => {
      return simnet.getDataVar('${contractId}', '${variable.name}');
    }`;
}

/**
 * Generate TypeScript type for map key based on its structure
 */
function getMapKeyType(keyType: AbiType): string {
  // Map keys are typically tuples
  if (isAbiTuple(keyType)) {
    const fields = keyType.tuple
      .map(
        (field) =>
          `${toCamelCase(field.name)}: ${getTypeForArg({ type: field.type })}`
      )
      .join("; ");
    return `{ ${fields} }`;
  }

  // Single-value keys (less common but possible)
  return getTypeForArg({ type: keyType });
}

/**
 * Generate Clarity conversion for map key
 */
function generateMapKeyConversion(keyType: AbiType): string {
  // Map keys are typically tuples
  if (isAbiTuple(keyType)) {
    const fields = keyType.tuple
      .map((field) => {
        const camelFieldName = toCamelCase(field.name);
        const fieldConversion = generateClarityConversion(
          `key.${camelFieldName}`,
          { type: field.type }
        );
        return `"${field.name}": ${fieldConversion}`;
      })
      .join(", ");
    return `Cl.tuple({ ${fields} })`;
  }

  // Single-value keys
  return generateClarityConversion("key", { type: keyType });
}

/**
 * Generate a map entry accessor helper
 */
function generateMapEntryHelper(map: AbiMap, contractId: string): string {
  const methodName = toCamelCase(map.name);
  const keyType = getMapKeyType(map.key);
  const keyConversion = generateMapKeyConversion(map.key);

  return `${methodName}: (key: ${keyType}) => {
      return simnet.getMapEntry(
        '${contractId}',
        '${map.name}',
        ${keyConversion}
      );
    }`;
}

/**
 * Generate the vars object containing all data variable accessors
 */
function generateVarsObject(
  variables: readonly AbiVariable[],
  contractId: string
): string {
  // Filter to only include mutable variables (not constants)
  const dataVars = variables.filter((v) => v.access === "variable");

  if (dataVars.length === 0) {
    return "";
  }

  const varHelpers = dataVars.map((v) => generateDataVarHelper(v, contractId));

  return `vars: {
      ${varHelpers.join(",\n\n      ")}
    }`;
}

/**
 * Generate the maps object containing all map entry accessors
 */
function generateMapsObject(maps: readonly AbiMap[], contractId: string): string {
  if (maps.length === 0) {
    return "";
  }

  const mapHelpers = maps.map((m) => generateMapEntryHelper(m, contractId));

  return `maps: {
      ${mapHelpers.join(",\n\n      ")}
    }`;
}

/**
 * Generate a contract helper factory function
 */
function generateContractHelper(
  contract: ProcessedContract,
  options: TestingPluginOptions
): string {
  const { abi, name, address } = contract;
  const functions = abi.functions || [];
  const variables = abi.variables || [];
  const maps = abi.maps || [];
  const pascalName = toPascalCase(name);

  // Filter functions by access type
  const publicFns = functions.filter(
    (f: AbiFunction) => f.access === "public"
  );
  const readOnlyFns = functions.filter(
    (f: AbiFunction) =>
      f.access === "read-only"
  );
  const privateFns = options.includePrivate
    ? functions.filter((f: AbiFunction) => f.access === "private")
    : [];

  // Generate function helpers
  const publicHelpers = publicFns.map((f: AbiFunction) =>
    generatePublicFunction(f, address)
  );
  const readOnlyHelpers = readOnlyFns.map((f: AbiFunction) =>
    generateReadOnlyFunction(f, address)
  );
  const privateHelpers = privateFns.map((f: AbiFunction) =>
    generatePrivateFunction(f, address)
  );

  // Generate data variable and map accessors
  const varsObject = generateVarsObject(variables, address);
  const mapsObject = generateMapsObject(maps, address);

  const allHelpers = [...publicHelpers, ...readOnlyHelpers, ...privateHelpers];

  // Include vars and maps objects if they have content
  if (varsObject) {
    allHelpers.push(varsObject);
  }
  if (mapsObject) {
    allHelpers.push(mapsObject);
  }

  if (allHelpers.length === 0) {
    return "";
  }

  return `export function get${pascalName}(simnet: Simnet) {
  const accounts = simnet.getAccounts();

  return {
    ${allHelpers.join(",\n\n    ")}
  };
}`;
}

/**
 * Generate the getContracts convenience wrapper
 */
function generateGetContracts(contracts: ProcessedContract[]): string {
  const contractEntries = contracts
    .map((contract) => {
      const camelName = toCamelCase(contract.name);
      const pascalName = toPascalCase(contract.name);
      return `${camelName}: get${pascalName}(simnet)`;
    })
    .join(",\n    ");

  return `export function getContracts(simnet: Simnet) {
  const accounts = simnet.getAccounts();

  return {
    accounts,
    ${contractEntries}
  };
}`;
}

/**
 * Generate type exports for consumer convenience
 */
function generateTypeExports(contracts: ProcessedContract[]): string {
  const typeExports = contracts
    .map((contract) => {
      const pascalName = toPascalCase(contract.name);
      return `export type ${pascalName}Helpers = ReturnType<typeof get${pascalName}>;`;
    })
    .join("\n");

  return `${typeExports}
export type Contracts = ReturnType<typeof getContracts>;`;
}

/**
 * Main entry point - generates the full testing helpers file
 */
export async function generateTestingHelpers(
  contracts: ProcessedContract[],
  options: TestingPluginOptions
): Promise<string> {
  const contractHelpers = contracts
    .map((contract) => generateContractHelper(contract, options))
    .filter(Boolean);

  if (contractHelpers.length === 0) {
    return `// No contracts with functions to generate helpers for
export {};`;
  }

  const getContractsCode = generateGetContracts(contracts);
  const typeExports = generateTypeExports(contracts);

  return `/**
 * Generated by @secondlayer/cli testing plugin
 * Type-safe helpers for Clarinet SDK unit tests
 */

import { type Simnet, Cl } from '@hirosystems/clarinet-sdk';

// ============================================
// Per-contract factory functions
// ============================================

${contractHelpers.join("\n\n")}

// ============================================
// Convenience: all contracts at once
// ============================================

${getContractsCode}

// ============================================
// Type exports
// ============================================

${typeExports}
`;
}
