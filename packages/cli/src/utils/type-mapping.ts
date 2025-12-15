/**
 * Shared type mapping utility for Clarity types to TypeScript types
 *
 * This module provides a single, consistent implementation for mapping
 * Clarity types to their TypeScript equivalents, used across all generators.
 */

import {
  toCamelCase,
  isClarityList,
  isClarityTuple,
  isClarityOptional,
  isClarityResponse,
  isClarityBuffer,
  isClarityStringAscii,
  isClarityStringUtf8,
  type ClarityType,
} from "@secondlayer/clarity-types";

/**
 * Map a Clarity type to its TypeScript type string representation
 *
 * @param type - The Clarity type definition from an ABI
 * @returns The TypeScript type string (e.g., "bigint", "string", "{ field: bigint }")
 */
export function clarityTypeToTS(type: ClarityType): string {
  // Handle string primitive types
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
      default: {
        // Handle shorthand string formats (e.g., "string-ascii", "string-utf8", "buff")
        // Cast to string since TypeScript narrows to never in exhaustive switches
        const typeStr = type as string;
        // Handle "none" type (commonly used in response types)
        if (typeStr === "none") {
          return "null";
        }
        if (typeStr.includes("string") || typeStr.includes("ascii") || typeStr.includes("utf8")) {
          return "string";
        }
        if (typeStr.includes("buff")) {
          return "Uint8Array | string | { type: 'ascii' | 'utf8' | 'hex'; value: string }";
        }
        if (typeStr.includes("uint") || typeStr.includes("int")) {
          return "bigint";
        }
        return "any";
      }
    }
  }

  // Handle buffer types - support flexible input
  if (isClarityBuffer(type)) {
    return "Uint8Array | string | { type: 'ascii' | 'utf8' | 'hex'; value: string }";
  }

  // Handle string types
  if (isClarityStringAscii(type) || isClarityStringUtf8(type)) {
    return "string";
  }

  // Handle optional types
  if (isClarityOptional(type)) {
    const innerType = clarityTypeToTS(type.optional);
    // Wrap union types in parentheses for correct precedence
    if (innerType.includes(" | ") && !innerType.startsWith("(")) {
      return `(${innerType}) | null`;
    }
    return `${innerType} | null`;
  }

  // Handle list types
  if (isClarityList(type)) {
    const innerType = clarityTypeToTS(type.list.type);
    // Wrap union types in parentheses for correct precedence
    if (innerType.includes(" | ") && !innerType.startsWith("(")) {
      return `(${innerType})[]`;
    }
    return `${innerType}[]`;
  }

  // Handle tuple types
  if (isClarityTuple(type)) {
    const fields = type.tuple
      .map((field) => `${toCamelCase(field.name)}: ${clarityTypeToTS(field.type)}`)
      .join("; ");
    return `{ ${fields} }`;
  }

  // Handle response types
  if (isClarityResponse(type)) {
    const okType = clarityTypeToTS(type.response.ok);
    const errType = clarityTypeToTS(type.response.error);
    return `{ ok: ${okType} } | { err: ${errType} }`;
  }

  // Fallback for unknown types
  return "any";
}

/**
 * Map a Clarity argument definition to its TypeScript type
 * This is a convenience wrapper that extracts the type from an argument object
 *
 * @param arg - An argument object with a `type` property
 * @returns The TypeScript type string
 */
export function getTypeForArg(arg: { type: ClarityType }): string {
  return clarityTypeToTS(arg.type);
}

/**
 * Generate a TypeScript type signature for function arguments
 *
 * @param args - Array of argument definitions with name and type
 * @returns TypeScript type string like "{ arg1: bigint; arg2: string }"
 */
export function generateArgsTypeSignature(
  args: readonly { name: string; type: ClarityType }[]
): string {
  if (args.length === 0) return "void";

  const argsList = args
    .map((arg) => `${toCamelCase(arg.name)}: ${clarityTypeToTS(arg.type)}`)
    .join("; ");
  return `{ ${argsList} }`;
}
