import type { ClarityType } from "../types/composites";
import type { ClarityFunction } from "../abi/functions";
import {
  isUint128,
  isInt128,
  isBool,
  isPrincipal,
  isString,
  isUint8Array,
  isClarityList,
  isClarityTuple,
  isClarityOptional,
  isClarityResponse,
  isClarityBuffer,
  isClarityStringAscii,
  isClarityStringUtf8,
} from "../validation/guards";
import { toCamelCase } from "../utils";

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

/**
 * Convert and validate JS value to Clarity value.
 * Performs full recursive validation for all Clarity types including composites.
 */
export function jsToClarity(type: ClarityType, value: unknown): unknown {
  // Primitive types
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

  // String types with length validation
  if (isClarityStringAscii(type)) {
    if (!isString(value)) {
      throw new ClarityConversionError(
        "Invalid string-ascii value",
        type,
        value
      );
    }
    const str = value as string;

    // Validate ASCII only (0x00-0x7F)
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) {
        throw new ClarityConversionError(
          `Non-ASCII character at position ${i}: '${str[i]}' (code ${str.charCodeAt(i)})`,
          type,
          value
        );
      }
    }

    if (str.length > type["string-ascii"].length) {
      throw new ClarityConversionError(
        `String length ${str.length} exceeds max ${type["string-ascii"].length}`,
        type,
        value
      );
    }
    return value;
  }

  if (isClarityStringUtf8(type)) {
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

  // Buffer type with length validation
  if (isClarityBuffer(type)) {
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

  // List type with length enforcement and recursive element validation
  if (isClarityList(type)) {
    if (!Array.isArray(value)) {
      throw new ClarityConversionError(
        "Expected array for list type",
        type,
        value
      );
    }
    if (value.length > type.list.length) {
      throw new ClarityConversionError(
        `List length ${value.length} exceeds max ${type.list.length}`,
        type,
        value
      );
    }
    return value.map((item) => jsToClarity(type.list.type, item));
  }

  // Tuple type with field validation
  if (isClarityTuple(type)) {
    if (typeof value !== "object" || value === null) {
      throw new ClarityConversionError(
        "Expected object for tuple type",
        type,
        value
      );
    }
    const result: Record<string, unknown> = {};
    for (const field of type.tuple) {
      const camelKey = toCamelCase(field.name);
      // Check both original and camelCase keys for flexibility
      const hasOriginal = field.name in (value as object);
      const hasCamel = camelKey in (value as object);
      if (!hasOriginal && !hasCamel) {
        throw new ClarityConversionError(
          `Missing tuple field: ${field.name}`,
          type,
          value
        );
      }
      const fieldValue = hasOriginal
        ? (value as Record<string, unknown>)[field.name]
        : (value as Record<string, unknown>)[camelKey];
      result[field.name] = jsToClarity(field.type, fieldValue);
    }
    return result;
  }

  // Optional type - null/undefined means none
  if (isClarityOptional(type)) {
    if (value === null || value === undefined) {
      return null;
    }
    return jsToClarity(type.optional, value);
  }

  // Response type - must have exactly 'ok' or 'err'
  if (isClarityResponse(type)) {
    if (typeof value !== "object" || value === null) {
      throw new ClarityConversionError(
        "Expected object for response type",
        type,
        value
      );
    }
    const hasOk = "ok" in value;
    const hasErr = "err" in value;

    if (hasOk && !hasErr) {
      return { ok: jsToClarity(type.response.ok, (value as { ok: unknown }).ok) };
    }
    if (hasErr && !hasOk) {
      return {
        err: jsToClarity(type.response.error, (value as { err: unknown }).err),
      };
    }
    throw new ClarityConversionError(
      "Response must have exactly 'ok' or 'err' property",
      type,
      value
    );
  }

  throw new ClarityConversionError(`Unknown Clarity type`, type, value);
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
