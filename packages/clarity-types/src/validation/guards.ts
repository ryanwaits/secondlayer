import {
  MAX_U128,
  MIN_I128,
  MAX_I128,
  PRINCIPAL_REGEX,
  STANDARD_PRINCIPAL_REGEX,
  CONTRACT_PRINCIPAL_REGEX,
} from "../types/primitives";
import type { ResponseOk, ResponseErr } from "../types/mappings";

/**
 * Runtime type guards for Clarity values
 */

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
  return typeof value === "string" && PRINCIPAL_REGEX.test(value);
}

export function isStandardPrincipal(value: unknown): value is string {
  return typeof value === "string" && STANDARD_PRINCIPAL_REGEX.test(value);
}

export function isContractPrincipal(value: unknown): value is string {
  return typeof value === "string" && CONTRACT_PRINCIPAL_REGEX.test(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function isArray<T>(
  value: unknown,
  itemGuard: (item: unknown) => item is T
): value is T[] {
  return Array.isArray(value) && value.every(itemGuard);
}

export function isOptional<T>(
  value: unknown,
  guard: (val: unknown) => val is T
): value is T | null {
  return value === null || guard(value);
}

export function isOkResponse<T>(
  response: { ok: T } | { err: any }
): response is ResponseOk<T> {
  return "ok" in response && !("err" in response);
}

export function isErrResponse<E>(
  response: { ok: any } | { err: E }
): response is ResponseErr<E> {
  return "err" in response && !("ok" in response);
}

export function isResponse<T, E>(
  value: unknown,
  okGuard: (val: unknown) => val is T,
  errGuard: (val: unknown) => val is E
): value is ResponseOk<T> | ResponseErr<E> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if ("ok" in value && !("err" in value)) {
    return okGuard((value as any).ok);
  }

  if ("err" in value && !("ok" in value)) {
    return errGuard((value as any).err);
  }

  return false;
}
