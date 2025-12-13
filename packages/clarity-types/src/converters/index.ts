import type { ClarityType } from "../types/composites";
import type { ClarityFunction } from "../abi/functions";
import {
  isUint128,
  isInt128,
  isBool,
  isPrincipal,
  isString,
  isUint8Array,
} from "../validation/guards";

/**
 * Value converters between JavaScript and Clarity representations
 */

export class ClarityConversionError extends Error {
  constructor(
    message: string,
    public readonly type: ClarityType,
    public readonly value: unknown
  ) {
    super(message);
    this.name = "ClarityConversionError";
  }
}

// Convert JS value to validated Clarity value
export function jsToClarity(type: ClarityType, value: unknown): unknown {
  if (type === "uint128") {
    if (!isUint128(value)) {
      throw new ClarityConversionError("Invalid uint128 value", type, value);
    }
    return value;
  }

  if (type === "int128") {
    if (!isInt128(value)) {
      throw new ClarityConversionError("Invalid int128 value", type, value);
    }
    return value;
  }

  if (type === "bool") {
    if (!isBool(value)) {
      throw new ClarityConversionError("Invalid bool value", type, value);
    }
    return value;
  }

  if (type === "principal") {
    if (!isPrincipal(value)) {
      throw new ClarityConversionError("Invalid principal value", type, value);
    }
    return value;
  }

  if (type === "trait_reference") {
    if (!isPrincipal(value)) {
      throw new ClarityConversionError(
        "Invalid trait_reference value",
        type,
        value
      );
    }
    return value;
  }

  if (typeof type === "object" && "string-ascii" in type) {
    if (!isString(value)) {
      throw new ClarityConversionError(
        "Invalid string-ascii value",
        type,
        value
      );
    }
    const str = value as string;
    if (str.length > type["string-ascii"].length) {
      throw new ClarityConversionError(
        `String length ${str.length} exceeds max ${type["string-ascii"].length}`,
        type,
        value
      );
    }
    return value;
  }

  if (typeof type === "object" && "string-utf8" in type) {
    if (!isString(value)) {
      throw new ClarityConversionError(
        "Invalid string-utf8 value",
        type,
        value
      );
    }
    const str = value as string;
    const byteLength = new TextEncoder().encode(str).length;
    if (byteLength > type["string-utf8"].length) {
      throw new ClarityConversionError(
        `String byte length ${byteLength} exceeds max ${type["string-utf8"].length}`,
        type,
        value
      );
    }
    return value;
  }

  if (typeof type === "object" && "buff" in type) {
    if (!isUint8Array(value)) {
      throw new ClarityConversionError("Invalid buffer value", type, value);
    }
    const buff = value as Uint8Array;
    if (buff.length > type.buff.length) {
      throw new ClarityConversionError(
        `Buffer length ${buff.length} exceeds max ${type.buff.length}`,
        type,
        value
      );
    }
    return value;
  }

  // TODO: For composite types (simplified for now)
  return value;
}

// Helper to prepare function arguments
export function prepareArgs<F extends ClarityFunction>(
  func: F,
  args: Record<string, unknown>
): unknown[] {
  return func.args.map((arg) => {
    if (!(arg.name in args)) {
      throw new Error(`Missing argument: ${arg.name}`);
    }
    return jsToClarity(arg.type, args[arg.name]);
  });
}

// Helper to validate function arguments (named)
export function validateArgs<F extends ClarityFunction>(
  func: F,
  args: Record<string, unknown>
): void {
  for (const arg of func.args) {
    if (!(arg.name in args)) {
      throw new Error(`Missing argument: ${arg.name}`);
    }
    jsToClarity(arg.type, args[arg.name]);
  }
}

// Helper to validate function arguments (positional)
export function validateArgsArray<F extends ClarityFunction>(
  func: F,
  args: unknown[]
): void {
  if (args.length !== func.args.length) {
    throw new Error(
      `Expected ${func.args.length} arguments, got ${args.length}`
    );
  }

  func.args.forEach((arg, i) => {
    jsToClarity(arg.type, args[i]);
  });
}
