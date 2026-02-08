import type { AbiType } from "./types.ts";
import type { AbiFunction } from "./contract.ts";
import {
  isUint128,
  isInt128,
  isBool,
  isPrincipal,
  isString,
  isUint8Array,
  isAbiList,
  isAbiTuple,
  isAbiOptional,
  isAbiResponse,
  isAbiBuffer,
  isAbiStringAscii,
  isAbiStringUtf8,
} from "./guards.ts";
import { toCamelCase } from "./utils.ts";

export class ClarityConversionError extends Error {
  constructor(
    message: string,
    public readonly type: AbiType,
    public readonly value: unknown,
  ) {
    super(message);
    this.name = "ClarityConversionError";
  }
}

export function jsToClarity(type: AbiType, value: unknown): unknown {
  if (type === "none") return null;

  if (type === "uint128") {
    if (!isUint128(value))
      throw new ClarityConversionError("Invalid uint128 value", type, value);
    return value;
  }

  if (type === "int128") {
    if (!isInt128(value))
      throw new ClarityConversionError("Invalid int128 value", type, value);
    return value;
  }

  if (type === "bool") {
    if (!isBool(value))
      throw new ClarityConversionError("Invalid bool value", type, value);
    return value;
  }

  if (type === "principal") {
    if (!isPrincipal(value))
      throw new ClarityConversionError("Invalid principal value", type, value);
    return value;
  }

  if (type === "trait_reference") {
    if (!isPrincipal(value))
      throw new ClarityConversionError(
        "Invalid trait_reference value",
        type,
        value,
      );
    return value;
  }

  if (isAbiStringAscii(type)) {
    if (!isString(value))
      throw new ClarityConversionError(
        "Invalid string-ascii value",
        type,
        value,
      );
    const str = value as string;
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 127) {
        throw new ClarityConversionError(
          `Non-ASCII character at position ${i}: '${str[i]}' (code ${str.charCodeAt(i)})`,
          type,
          value,
        );
      }
    }
    if (str.length > type["string-ascii"].length) {
      throw new ClarityConversionError(
        `String length ${str.length} exceeds max ${type["string-ascii"].length}`,
        type,
        value,
      );
    }
    return value;
  }

  if (isAbiStringUtf8(type)) {
    if (!isString(value))
      throw new ClarityConversionError(
        "Invalid string-utf8 value",
        type,
        value,
      );
    const str = value as string;
    const byteLength = new TextEncoder().encode(str).length;
    if (byteLength > type["string-utf8"].length) {
      throw new ClarityConversionError(
        `String byte length ${byteLength} exceeds max ${type["string-utf8"].length}`,
        type,
        value,
      );
    }
    return value;
  }

  if (isAbiBuffer(type)) {
    if (!isUint8Array(value))
      throw new ClarityConversionError("Invalid buffer value", type, value);
    const buff = value as Uint8Array;
    if (buff.length > type.buff.length) {
      throw new ClarityConversionError(
        `Buffer length ${buff.length} exceeds max ${type.buff.length}`,
        type,
        value,
      );
    }
    return value;
  }

  if (isAbiList(type)) {
    if (!Array.isArray(value))
      throw new ClarityConversionError(
        "Expected array for list type",
        type,
        value,
      );
    if (value.length > type.list.length) {
      throw new ClarityConversionError(
        `List length ${value.length} exceeds max ${type.list.length}`,
        type,
        value,
      );
    }
    return value.map((item) => jsToClarity(type.list.type, item));
  }

  if (isAbiTuple(type)) {
    if (typeof value !== "object" || value === null)
      throw new ClarityConversionError(
        "Expected object for tuple type",
        type,
        value,
      );
    const result: Record<string, unknown> = {};
    for (const field of type.tuple) {
      const camelKey = toCamelCase(field.name);
      const hasOriginal = field.name in (value as object);
      const hasCamel = camelKey in (value as object);
      if (!hasOriginal && !hasCamel) {
        throw new ClarityConversionError(
          `Missing tuple field: ${field.name}`,
          type,
          value,
        );
      }
      const fieldValue = hasOriginal
        ? (value as Record<string, unknown>)[field.name]
        : (value as Record<string, unknown>)[camelKey];
      result[field.name] = jsToClarity(field.type, fieldValue);
    }
    return result;
  }

  if (isAbiOptional(type)) {
    if (value === null || value === undefined) return null;
    return jsToClarity(type.optional, value);
  }

  if (isAbiResponse(type)) {
    if (typeof value !== "object" || value === null)
      throw new ClarityConversionError(
        "Expected object for response type",
        type,
        value,
      );
    const hasOk = "ok" in value;
    const hasErr = "err" in value;
    if (hasOk && !hasErr) {
      return {
        ok: jsToClarity(type.response.ok, (value as { ok: unknown }).ok),
      };
    }
    if (hasErr && !hasOk) {
      return {
        err: jsToClarity(
          type.response.error,
          (value as { err: unknown }).err,
        ),
      };
    }
    throw new ClarityConversionError(
      "Response must have exactly 'ok' or 'err' property",
      type,
      value,
    );
  }

  throw new ClarityConversionError(`Unknown Clarity type`, type, value);
}

export function prepareArgs<F extends AbiFunction>(
  func: F,
  args: Record<string, unknown>,
): unknown[] {
  return func.args.map((arg) => {
    if (!(arg.name in args)) {
      throw new ClarityConversionError(
        `Missing argument: ${arg.name}`,
        arg.type,
        undefined,
      );
    }
    return jsToClarity(arg.type, args[arg.name]);
  });
}

export function validateArgs<F extends AbiFunction>(
  func: F,
  args: Record<string, unknown>,
): void {
  for (const arg of func.args) {
    if (!(arg.name in args)) {
      throw new ClarityConversionError(
        `Missing argument: ${arg.name}`,
        arg.type,
        undefined,
      );
    }
    jsToClarity(arg.type, args[arg.name]);
  }
}

export function validateArgsArray<F extends AbiFunction>(
  func: F,
  args: unknown[],
): void {
  if (args.length !== func.args.length) {
    throw new ClarityConversionError(
      `Expected ${func.args.length} arguments, got ${args.length}`,
      func.args[0]?.type ?? "bool",
      args,
    );
  }
  func.args.forEach((arg, i) => {
    jsToClarity(arg.type, args[i]);
  });
}
