/**
 * Action generators for read and write helper functions
 */

import type { ProcessedContract } from "../../types/plugin";
import type { ClarityFunction } from "@secondlayer/clarity-types";
import type { ActionsPluginOptions } from "./index";

/**
 * Convert string to camelCase (enhanced version from old generator)
 */
function toCamelCase(str: string): string {
  return str
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/-([A-Z])/g, (_, letter) => letter)
    .replace(/-(\d)/g, (_, digit) => digit)
    .replace(/-/g, "")
    .replace(/^\d/, "_$&");
}

/**
 * Generate TypeScript type for Clarity argument (from old generator)
 */
function getTypeForArg(arg: any): string {
  const type = arg.type;

  if (typeof type === "string") {
    switch (type) {
      case "uint128":
      case "int128":
        return "bigint";
      case "bool":
        return "boolean";
      case "principal":
      case "trait_reference":
        return "string";
      default:
        return "any";
    }
  }

  if (type["string-ascii"] || type["string-utf8"]) {
    return "string";
  }

  if (type.buff) {
    return "Uint8Array | string | { type: 'ascii' | 'utf8' | 'hex'; value: string }";
  }

  if (type.optional) {
    const innerType = getTypeForArg({ type: type.optional });
    return `${innerType} | null`;
  }

  if (type.list) {
    const innerType = getTypeForArg({ type: type.list.type });
    return `${innerType}[]`;
  }

  if (type.tuple) {
    const fields = type.tuple
      .map(
        (field: any) =>
          `${toCamelCase(field.name)}: ${getTypeForArg({ type: field.type })}`
      )
      .join("; ");
    return `{ ${fields} }`;
  }

  if (type.response) {
    const okType = getTypeForArg({ type: type.response.ok });
    const errType = getTypeForArg({ type: type.response.error });
    return `{ ok: ${okType} } | { err: ${errType} }`;
  }

  return "any";
}

/**
 * Generate arguments signature for helper functions
 */
function generateArgsSignature(args: readonly any[]): string {
  if (args.length === 0) return "";

  const argsTypes = args
    .map((arg) => {
      const camelName = toCamelCase(arg.name);
      return `${camelName}: ${getTypeForArg(arg)}`;
    })
    .join("; ");

  return `args: { ${argsTypes} }, `;
}

/**
 * Generate Clarity arguments for function calls
 */
function generateClarityArgs(
  args: readonly any[],
  _contractName: string
): string {
  if (args.length === 0) return "";

  return args
    .map((arg) => {
      const argName = `args.${toCamelCase(arg.name)}`;
      return generateClarityConversion(argName, arg);
    })
    .join(", ");
}

/**
 * Convert TypeScript value to ClarityValue based on the argument type (from old generator)
 */
function generateClarityConversion(argName: string, argType: any): string {
  const type = argType.type;

  if (typeof type === "string") {
    switch (type) {
      case "uint128":
        return `Cl.uint(${argName})`;
      case "int128":
        return `Cl.int(${argName})`;
      case "bool":
        return `Cl.bool(${argName})`;
      case "principal":
      case "trait_reference":
        return `(() => {
          const [address, contractName] = ${argName}.split(".") as [string, string];
          if (!validateStacksAddress(address)) {
            throw new Error("Invalid Stacks address format");
          }
          if (${argName}.includes(".")) {
            return Cl.contractPrincipal(address, contractName);
          } else {
            return Cl.standardPrincipal(${argName});
          }
        })()`;
      default:
        return `${argName}`;
    }
  }

  if (type["string-ascii"]) {
    return `Cl.stringAscii(${argName})`;
  }

  if (type["string-utf8"]) {
    return `Cl.stringUtf8(${argName})`;
  }

  if (type.buff) {
    return `(() => {
      const value = ${argName};
      if (value instanceof Uint8Array) {
        return Cl.buffer(value);
      }
      if (typeof value === 'object' && value !== null && value.type && value.value) {
        switch (value.type) {
          case 'ascii':
            return Cl.bufferFromAscii(value.value);
          case 'utf8':
            return Cl.bufferFromUtf8(value.value);
          case 'hex':
            return Cl.bufferFromHex(value.value);
          default:
            throw new Error(\`Unsupported buffer type: \${value.type}\`);
        }
      }
      if (typeof value === 'string') {
        if (value.startsWith('0x') || /^[0-9a-fA-F]+$/.test(value)) {
          return Cl.bufferFromHex(value);
        }
        if (!/^[\\x00-\\x7F]*$/.test(value)) {
          return Cl.bufferFromUtf8(value);
        }
        return Cl.bufferFromAscii(value);
      }
      throw new Error(\`Invalid buffer value: \${value}\`);
    })()`;
  }

  if (type.optional) {
    const innerConversion = generateClarityConversion(argName, {
      type: type.optional,
    });
    return `${argName} !== null ? Cl.some(${innerConversion.replace(argName, `${argName}`)}) : Cl.none()`;
  }

  if (type.list) {
    const innerConversion = generateClarityConversion("item", {
      type: type.list.type,
    });
    return `Cl.list(${argName}.map(item => ${innerConversion}))`;
  }

  if (type.tuple) {
    const fields = type.tuple
      .map((field: any) => {
        const camelFieldName = toCamelCase(field.name);
        const fieldConversion = generateClarityConversion(
          `${argName}.${camelFieldName}`,
          { type: field.type }
        );
        return `"${field.name}": ${fieldConversion}`;
      })
      .join(", ");
    return `Cl.tuple({ ${fields} })`;
  }

  if (type.response) {
    const okConversion = generateClarityConversion(`${argName}.ok`, {
      type: type.response.ok,
    });
    const errConversion = generateClarityConversion(`${argName}.err`, {
      type: type.response.error,
    });
    return `'ok' in ${argName} ? Cl.ok(${okConversion.replace(`${argName}.ok`, `${argName}.ok`)}) : Cl.error(${errConversion.replace(`${argName}.err`, `${argName}.err`)})`;
  }

  return `${argName}`;
}

/**
 * Generate read helper functions for a contract (fixed version)
 */
function generateReadHelpers(
  contract: ProcessedContract,
  options: ActionsPluginOptions
): string {
  const { abi, name } = contract;
  const functions = abi.functions || [];

  const readOnlyFunctions = functions.filter(
    (f: ClarityFunction) =>
      (f.access as any) === "read_only" || f.access === "read-only"
  );

  if (readOnlyFunctions.length === 0) {
    return "";
  }

  // Apply function filters
  const filteredFunctions = readOnlyFunctions.filter(
    (func: ClarityFunction) => {
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

  const helpers = filteredFunctions.map((func: ClarityFunction) => {
    const methodName = toCamelCase(func.name);
    const argsSignature = generateArgsSignature(func.args);
    const clarityArgs = generateClarityArgs(func.args, name);

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
  const { abi, name } = contract;
  const functions = abi.functions || [];

  const publicFunctions = functions.filter(
    (f: ClarityFunction) => f.access === "public"
  );

  if (publicFunctions.length === 0) {
    return "";
  }

  // Apply function filters
  const filteredFunctions = publicFunctions.filter((func: ClarityFunction) => {
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

  const helpers = filteredFunctions.map((func: ClarityFunction) => {
    const methodName = toCamelCase(func.name);
    const argsSignature = generateArgsSignature(func.args);
    const clarityArgs = generateClarityArgs(func.args, name);

    return `async ${methodName}(${argsSignature}options: {
      senderKey: string;
      network?: 'mainnet' | 'testnet' | 'devnet';
      fee?: string | number | undefined;
      nonce?: bigint;
      anchorMode?: 1 | 2 | 3; // AnchorMode: OnChainOnly = 1, OffChainOnly = 2, Any = 3
      postConditions?: PostCondition[];
      validateWithAbi?: boolean;
    }) {
      const { senderKey, network = 'mainnet', ...txOptions } = options;
      
      return await makeContractCall({
        contractAddress: '${contract.address}',
        contractName: '${contract.contractName}',
        functionName: '${func.name}',
        functionArgs: [${clarityArgs}],
        senderKey,
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
