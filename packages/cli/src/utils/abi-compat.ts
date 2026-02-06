/**
 * ABI compatibility layer for normalizing different ABI formats
 *
 * Handles differences between:
 * - Upstream ClarityAbi types (uses `buffer`, `read_only`)
 * - Internal format (uses `buff`, `read-only`)
 */

import type {
  AbiContract,
  AbiFunction,
  AbiMap,
  AbiVariable,
  AbiType,
} from "@secondlayer/stacks/clarity";

/**
 * Normalize function access type from various formats to internal format
 */
export function normalizeAccess(
  access: string
): "public" | "read-only" | "private" {
  if (access === "read_only") return "read-only";
  return access as "public" | "read-only" | "private";
}

/**
 * Normalize a Clarity type from API format to internal format
 * Handles buffer vs buff, and recursively normalizes nested types
 */
export function normalizeType(type: unknown): AbiType {
  if (typeof type === "string") {
    // Handle string primitive types
    switch (type) {
      case "uint128":
      case "int128":
      case "bool":
      case "principal":
      case "trait_reference":
        return type;
      default:
        // Unknown string type, return as-is
        return type as AbiType;
    }
  }

  if (typeof type !== "object" || type === null) {
    throw new Error(`Invalid ABI type: expected object, got ${typeof type}`);
  }

  const typeObj = type as Record<string, unknown>;

  // Handle buffer vs buff (API uses buffer, we use buff)
  if ("buffer" in typeObj) {
    const buffer = typeObj.buffer as { length?: number };
    return {
      buff: {
        length: buffer?.length ?? 32,
      },
    };
  }

  // Already in internal format
  if ("buff" in typeObj) {
    const buff = typeObj.buff as { length?: number };
    return {
      buff: {
        length: buff?.length ?? 32,
      },
    };
  }

  // String types
  if ("string-ascii" in typeObj) {
    const strAscii = typeObj["string-ascii"] as { length?: number };
    return {
      "string-ascii": {
        length: strAscii?.length ?? 256,
      },
    };
  }

  if ("string-utf8" in typeObj) {
    const strUtf8 = typeObj["string-utf8"] as { length?: number };
    return {
      "string-utf8": {
        length: strUtf8?.length ?? 256,
      },
    };
  }

  // Response type - recursively normalize ok and error types
  if ("response" in typeObj) {
    const response = typeObj.response as { ok?: unknown; error?: unknown };
    return {
      response: {
        ok: normalizeType(response?.ok ?? "bool"),
        error: normalizeType(response?.error ?? "uint128"),
      },
    };
  }

  // Optional type - recursively normalize inner type
  if ("optional" in typeObj) {
    return {
      optional: normalizeType(typeObj.optional),
    };
  }

  // List type - recursively normalize element type
  if ("list" in typeObj) {
    const list = typeObj.list as { type?: unknown; length?: number };
    return {
      list: {
        type: normalizeType(list?.type ?? "uint128"),
        length: list?.length ?? 100,
      },
    };
  }

  // Tuple type - recursively normalize field types
  if ("tuple" in typeObj) {
    const tuple = typeObj.tuple as Array<{ name: string; type: unknown }>;
    return {
      tuple: tuple.map((field) => ({
        name: field.name,
        type: normalizeType(field.type),
      })),
    };
  }

  // Unknown type - fail explicitly
  throw new Error(`Unknown ABI type structure: ${JSON.stringify(type)}`);
}

/**
 * Normalize a function definition from API format to internal format
 */
export function normalizeFunction(func: Record<string, unknown>): AbiFunction {
  const access = normalizeAccess(func.access as string);
  const args = (func.args as Array<{ name: string; type: unknown }>) ?? [];
  const outputs = func.outputs as { type?: unknown } | unknown;

  return {
    name: func.name as string,
    access,
    args: args.map((arg) => ({
      name: arg.name,
      type: normalizeType(arg.type),
    })),
    outputs: normalizeType(
      typeof outputs === "object" && outputs !== null && "type" in outputs
        ? (outputs as { type: unknown }).type
        : outputs
    ),
  };
}

/**
 * Normalize a map definition from API format to internal format
 */
export function normalizeMap(map: Record<string, unknown>): AbiMap {
  return {
    name: map.name as string,
    key: normalizeType(map.key),
    value: normalizeType(map.value),
  };
}

/**
 * Normalize a variable definition from API format to internal format
 */
export function normalizeVariable(
  variable: Record<string, unknown>
): AbiVariable {
  return {
    name: variable.name as string,
    type: normalizeType(variable.type),
    access: variable.access as "constant" | "variable",
  };
}

/**
 * Normalize an entire ABI from various sources to consistent internal format
 *
 * This handles ABIs from:
 * - Hiro API responses
 * - Clarinet SDK
 * - Upstream @secondlayer/stacks types
 */
export function normalizeAbi(abi: unknown): AbiContract {
  if (typeof abi !== "object" || abi === null) {
    return { functions: [] };
  }

  const abiObj = abi as Record<string, unknown>;

  const functions: AbiFunction[] = [];
  const maps: AbiMap[] = [];
  const variables: AbiVariable[] = [];

  // Normalize functions
  if (Array.isArray(abiObj.functions)) {
    for (const func of abiObj.functions) {
      if (typeof func === "object" && func !== null) {
        functions.push(normalizeFunction(func as Record<string, unknown>));
      }
    }
  }

  // Normalize maps
  if (Array.isArray(abiObj.maps)) {
    for (const map of abiObj.maps) {
      if (typeof map === "object" && map !== null) {
        maps.push(normalizeMap(map as Record<string, unknown>));
      }
    }
  }

  // Normalize variables
  if (Array.isArray(abiObj.variables)) {
    for (const variable of abiObj.variables) {
      if (typeof variable === "object" && variable !== null) {
        variables.push(normalizeVariable(variable as Record<string, unknown>));
      }
    }
  }

  return {
    functions,
    maps: maps.length > 0 ? maps : undefined,
    variables: variables.length > 0 ? variables : undefined,
  };
}
