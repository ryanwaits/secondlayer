import { validateStacksAddress } from "../../utils/address.ts";
import { MAX_U128, MIN_I128, MAX_I128, CONTRACT_NAME_REGEX } from "./types.ts";
import type { ResponseOk, ResponseErr } from "./mappings.ts";
import type {
  AbiType,
  AbiListType,
  AbiTupleType,
  AbiOptionalType,
  AbiResponseType,
  AbiBuffer,
  AbiStringAscii,
  AbiStringUtf8,
  AbiTraitReference,
} from "./types.ts";

// Value guards

export function isUint128(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n && value <= MAX_U128;
}

export function isInt128(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= MIN_I128 && value <= MAX_I128;
}

export function isBool(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isPrincipal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  const address = parts[0]!;
  const contractName = parts[1];
  if (!validateStacksAddress(address)) return false;
  if (contractName !== undefined) {
    return CONTRACT_NAME_REGEX.test(contractName);
  }
  return true;
}

export function isStandardPrincipal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.includes(".")) return false;
  return validateStacksAddress(value);
}

export function isContractPrincipal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.includes(".")) return false;
  const parts = value.split(".");
  const address = parts[0]!;
  const contractName = parts[1]!;
  if (!validateStacksAddress(address)) return false;
  return CONTRACT_NAME_REGEX.test(contractName);
}

export function isTraitReference(value: unknown): value is string {
  return isContractPrincipal(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function isArray<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(itemGuard);
}

export function isOptional<T>(
  value: unknown,
  guard: (val: unknown) => val is T,
): value is T | null {
  return value === null || guard(value);
}

export function isOkResponse<T>(
  response: { ok: T } | { err: any },
): response is ResponseOk<T> {
  return "ok" in response && !("err" in response);
}

export function isErrResponse<E>(
  response: { ok: any } | { err: E },
): response is ResponseErr<E> {
  return "err" in response && !("ok" in response);
}

export function isResponse<T, E>(
  value: unknown,
  okGuard: (val: unknown) => val is T,
  errGuard: (val: unknown) => val is E,
): value is ResponseOk<T> | ResponseErr<E> {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if ("ok" in value && !("err" in value)) return okGuard(obj.ok);
  if ("err" in value && !("ok" in value)) return errGuard(obj.err);
  return false;
}

// ABI type definition guards

export function isAbiList(type: AbiType): type is AbiListType {
  return typeof type === "object" && type !== null && "list" in type;
}

export function isAbiTuple(type: AbiType): type is AbiTupleType {
  return typeof type === "object" && type !== null && "tuple" in type;
}

export function isAbiOptional(type: AbiType): type is AbiOptionalType {
  return typeof type === "object" && type !== null && "optional" in type;
}

export function isAbiResponse(type: AbiType): type is AbiResponseType {
  return typeof type === "object" && type !== null && "response" in type;
}

export function isAbiBuffer(type: AbiType): type is AbiBuffer {
  return typeof type === "object" && type !== null && "buff" in type;
}

export function isAbiStringAscii(type: AbiType): type is AbiStringAscii {
  return typeof type === "object" && type !== null && "string-ascii" in type;
}

export function isAbiStringUtf8(type: AbiType): type is AbiStringUtf8 {
  return typeof type === "object" && type !== null && "string-utf8" in type;
}

export function isAbiTraitReference(type: AbiType): type is AbiTraitReference {
  return type === "trait_reference";
}
