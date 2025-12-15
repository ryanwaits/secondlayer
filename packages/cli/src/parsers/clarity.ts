import { promises as fs } from "fs";
import type {
  ClarityContract,
  ClarityFunction,
  ClarityType,
} from "@secondlayer/clarity-types";
import { normalizeAbi } from "../utils/abi-compat";

/**
 * Basic Clarity contract parser
 * This is a simplified parser - a full implementation would be more robust
 */

export async function parseClarityFile(
  filePath: string
): Promise<ClarityContract> {
  const content = await fs.readFile(filePath, "utf-8");
  return parseClarityContent(content);
}

export function parseClarityContent(content: string): ClarityContract {
  const functions: ClarityFunction[] = [];

  const functionRegex =
    /\(define-(public|read-only|private)\s+\(([^)]+)\)([\s\S]*?)\)\s*$/gm;

  let match;
  while ((match = functionRegex.exec(content)) !== null) {
    const [, access, signature, body] = match;
    const func = parseFunctionSignature(signature, access as any, body);
    if (func) {
      functions.push(func);
    }
  }

  return { functions };
}

function parseFunctionSignature(
  signature: string,
  access: "public" | "read-only" | "private",
  body: string
): ClarityFunction | null {
  // Parse function name and arguments
  const parts = signature.trim().split(/\s+/);
  const name = parts[0];

  const args: Array<{ name: string; type: ClarityType }> = [];

  // Parse arguments (simplified)
  for (let i = 1; i < parts.length; i += 2) {
    if (parts[i] && parts[i + 1]) {
      const argName = parts[i].replace(/[()]/g, "");
      const argType = parseType(parts[i + 1]);
      if (argType) {
        args.push({ name: argName, type: argType });
      }
    }
  }

  // Infer return type from body (simplified)
  const outputs = inferReturnType(body);

  return {
    name,
    access,
    args,
    outputs,
  };
}

function parseType(typeStr: string): ClarityType | null {
  typeStr = typeStr.replace(/[()]/g, "").trim();

  // Basic type mappings
  switch (typeStr) {
    case "uint":
    case "uint128":
      return "uint128";
    case "int":
    case "int128":
      return "int128";
    case "bool":
      return "bool";
    case "principal":
      return "principal";
    case "trait_reference":
      return "principal";
    default:
      // Handle complex types (simplified)
      if (typeStr.startsWith("string-ascii")) {
        return { "string-ascii": { length: 256 } };
      }
      if (typeStr.startsWith("string-utf8")) {
        return { "string-utf8": { length: 256 } };
      }
      if (typeStr.startsWith("buff")) {
        return { buff: { length: 32 } };
      }
      // Default to uint128 for unknown types
      return "uint128";
  }
}

function inferReturnType(body: string): ClarityType {
  // Simplified return type inference
  if (body.includes("(ok")) {
    if (body.includes("(err")) {
      return {
        response: {
          ok: "bool",
          error: "uint128",
        },
      };
    }
  }

  if (body.includes("true") || body.includes("false")) {
    return "bool";
  }

  return "bool";
}

/**
 * Parse ABI from API response
 * Uses the abi-compat normalization layer for consistent handling of different ABI formats
 */
export function parseApiResponse(apiResponse: any): ClarityContract {
  try {
    return normalizeAbi(apiResponse);
  } catch (error) {
    throw new Error(`Failed to parse API response: ${error}`);
  }
}
