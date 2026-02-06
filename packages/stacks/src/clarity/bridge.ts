import type { AbiType } from "./abi/types.ts";
import type { AbiToTS } from "./abi/mappings.ts";
import {
  isAbiList,
  isAbiTuple,
  isAbiOptional,
  isAbiResponse,
  isAbiBuffer,
  isAbiStringAscii,
  isAbiStringUtf8,
} from "./abi/guards.ts";
import { toCamelCase } from "./abi/utils.ts";
import type { ClarityValue } from "./types.ts";
import {
  intCV,
  uintCV,
  boolCV,
  bufferCV,
  noneCV,
  someCV,
  responseOkCV,
  responseErrorCV,
  listCV,
  tupleCV,
  stringAsciiCV,
  stringUtf8CV,
} from "./values.ts";
import { Cl } from "./values.ts";

/**
 * Convert a JS value to a ClarityValue using ABI type information.
 */
export function jsToClarityValue(abiType: AbiType, value: unknown): ClarityValue {
  if (abiType === "uint128") return uintCV(value as bigint | number);
  if (abiType === "int128") return intCV(value as bigint | number);
  if (abiType === "bool") return boolCV(value as boolean);
  if (abiType === "principal" || abiType === "trait_reference")
    return Cl.principal(value as string);

  if (isAbiStringAscii(abiType)) return stringAsciiCV(value as string);
  if (isAbiStringUtf8(abiType)) return stringUtf8CV(value as string);
  if (isAbiBuffer(abiType)) return bufferCV(value as Uint8Array);

  if (isAbiList(abiType)) {
    const arr = value as unknown[];
    return listCV(arr.map((item) => jsToClarityValue(abiType.list.type, item)));
  }

  if (isAbiTuple(abiType)) {
    const obj = value as Record<string, unknown>;
    const data: Record<string, ClarityValue> = {};
    for (const field of abiType.tuple) {
      const camelKey = toCamelCase(field.name);
      const hasOriginal = field.name in obj;
      const hasCamel = camelKey in obj;
      const fieldValue = hasOriginal ? obj[field.name] : hasCamel ? obj[camelKey] : undefined;
      if (fieldValue === undefined && !isAbiOptional(field.type)) {
        throw new Error(`Missing tuple field: ${field.name}`);
      }
      data[field.name] = jsToClarityValue(field.type, fieldValue);
    }
    return tupleCV(data);
  }

  if (isAbiOptional(abiType)) {
    if (value === null || value === undefined) return noneCV();
    return someCV(jsToClarityValue(abiType.optional, value));
  }

  if (isAbiResponse(abiType)) {
    const obj = value as Record<string, unknown>;
    if ("ok" in obj && !("err" in obj))
      return responseOkCV(jsToClarityValue(abiType.response.ok, obj.ok));
    if ("err" in obj && !("ok" in obj))
      return responseErrorCV(jsToClarityValue(abiType.response.error, obj.err));
    throw new Error("Response must have exactly 'ok' or 'err' property");
  }

  throw new Error(`Unknown ABI type: ${JSON.stringify(abiType)}`);
}

/**
 * Convert a ClarityValue back to a typed JS value using ABI type information.
 */
export function clarityValueToJS<T extends AbiType>(
  abiType: T,
  cv: ClarityValue,
): AbiToTS<T> {
  return clarityValueToJSInner(abiType, cv) as AbiToTS<T>;
}

/** Non-generic version for internal use — avoids deep type instantiation. */
export function clarityValueToJSUntyped(abiType: AbiType, cv: ClarityValue): unknown {
  return clarityValueToJSInner(abiType, cv);
}

function clarityValueToJSInner(abiType: AbiType, cv: ClarityValue): unknown {
  if (abiType === "uint128" || abiType === "int128") {
    if (cv.type !== "int" && cv.type !== "uint")
      throw new Error(`Expected int/uint CV, got ${cv.type}`);
    return cv.value;
  }

  if (abiType === "bool") {
    if (cv.type === "true") return true;
    if (cv.type === "false") return false;
    throw new Error(`Expected bool CV, got ${cv.type}`);
  }

  if (abiType === "principal" || abiType === "trait_reference") {
    if (cv.type !== "address" && cv.type !== "contract")
      throw new Error(`Expected principal CV, got ${cv.type}`);
    return cv.value;
  }

  if (isAbiStringAscii(abiType) || isAbiStringUtf8(abiType)) {
    if (cv.type !== "ascii" && cv.type !== "utf8")
      throw new Error(`Expected string CV, got ${cv.type}`);
    return cv.value;
  }

  if (isAbiBuffer(abiType)) {
    if (cv.type !== "buffer") throw new Error(`Expected buffer CV, got ${cv.type}`);
    // BufferCV stores hex string; convert back to Uint8Array
    const hex = cv.value;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  if (isAbiList(abiType)) {
    if (cv.type !== "list") throw new Error(`Expected list CV, got ${cv.type}`);
    return cv.value.map((item) => clarityValueToJSInner(abiType.list.type, item));
  }

  if (isAbiTuple(abiType)) {
    if (cv.type !== "tuple") throw new Error(`Expected tuple CV, got ${cv.type}`);
    const result: Record<string, unknown> = {};
    for (const field of abiType.tuple) {
      const fieldCV = cv.value[field.name];
      if (!fieldCV) throw new Error(`Missing tuple field in CV: ${field.name}`);
      const camelKey = toCamelCase(field.name);
      result[camelKey] = clarityValueToJSInner(field.type, fieldCV);
    }
    return result;
  }

  if (isAbiOptional(abiType)) {
    if (cv.type === "none") return null;
    if (cv.type === "some") return clarityValueToJSInner(abiType.optional, cv.value);
    throw new Error(`Expected optional CV, got ${cv.type}`);
  }

  if (isAbiResponse(abiType)) {
    if (cv.type === "ok") return { ok: clarityValueToJSInner(abiType.response.ok, cv.value) };
    if (cv.type === "err") return { err: clarityValueToJSInner(abiType.response.error, cv.value) };
    throw new Error(`Expected response CV, got ${cv.type}`);
  }

  throw new Error(`Unknown ABI type: ${JSON.stringify(abiType)}`);
}
