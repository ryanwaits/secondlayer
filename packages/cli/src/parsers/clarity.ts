import { promises as fs } from "fs";
import type {
  ClarityContract,
  ClarityFunction,
  ClarityType,
} from "@secondlayer/clarity-types";

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
 */
export function parseApiResponse(apiResponse: any): ClarityContract {
  try {
    const functions: ClarityFunction[] = [];

    if (apiResponse.functions) {
      for (const func of apiResponse.functions) {
        const access = func.access === "read_only" ? "read-only" : func.access;

        functions.push({
          name: func.name,
          access: access,
          args: func.args.map((arg: any) => ({
            name: arg.name,
            type: convertApiType(arg.type),
          })),
          outputs: convertApiType(func.outputs.type),
        });
      }
    }

    return { functions };
  } catch (error) {
    throw new Error(`Failed to parse API response: ${error}`);
  }
}

function convertApiType(apiType: any): ClarityType {
  if (typeof apiType === "string") {
    if (apiType === "trait_reference") {
      return "trait_reference";
    }
    return parseType(apiType) || "uint128";
  }

  // Handle complex types from API
  if (apiType.response) {
    return {
      response: {
        ok: convertApiType(apiType.response.ok),
        error: convertApiType(apiType.response.error),
      },
    };
  }

  if (apiType.optional) {
    return {
      optional: convertApiType(apiType.optional),
    };
  }

  if (apiType.list) {
    return {
      list: {
        type: convertApiType(apiType.list.type),
        length: apiType.list.length || 100,
      },
    };
  }

  if (apiType.tuple) {
    return {
      tuple: apiType.tuple.map((field: any) => ({
        name: field.name,
        type: convertApiType(field.type),
      })),
    };
  }

  if (apiType.buffer) {
    return {
      buff: {
        length: apiType.buffer.length || 32,
      },
    };
  }

  if (apiType["string-ascii"]) {
    return {
      "string-ascii": {
        length: apiType["string-ascii"].length || 256,
      },
    };
  }

  if (apiType["string-utf8"]) {
    return {
      "string-utf8": {
        length: apiType["string-utf8"].length || 256,
      },
    };
  }

  // Handle none type
  if (apiType === "none") {
    return "uint128"; // TODO: We'll need to handle this better in the future
  }

  // Default
  return "uint128";
}
