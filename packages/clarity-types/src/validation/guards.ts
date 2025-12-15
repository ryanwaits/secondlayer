import { validateStacksAddress } from "@stacks/transactions";
import {
  MAX_U128,
  MIN_I128,
  MAX_I128,
  CONTRACT_NAME_REGEX,
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

/**
 * Validates a Stacks principal (standard or contract) using upstream validation.
 * Supports mainnet (SP), testnet (ST), and other network prefixes with proper checksum validation.
 */
export function isPrincipal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [address, contractName] = value.split(".");
  if (!validateStacksAddress(address)) return false;
  // If there's a contract name part, validate it
  if (contractName !== undefined) {
    return CONTRACT_NAME_REGEX.test(contractName);
  }
  return true;
}

/**
 * Validates a standard Stacks principal (address only, no contract).
 * Supports mainnet (SP), testnet (ST), and other network prefixes.
 */
export function isStandardPrincipal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.includes(".")) return false;
  return validateStacksAddress(value);
}

/**
 * Validates a contract principal (address.contract-name format).
 * Uses upstream address validation with contract name regex validation.
 */
export function isContractPrincipal(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.includes(".")) return false;
  const [address, contractName] = value.split(".");
  if (!validateStacksAddress(address)) return false;
  return CONTRACT_NAME_REGEX.test(contractName);
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

// ============================================================================
// Clarity ABI Type Guards
// These guards check if a Clarity type definition is of a specific composite type
// ============================================================================

import type {
  ClarityType,
  ClarityListType,
  ClarityTupleType,
  ClarityOptionalType,
  ClarityResponseType,
} from "../types/composites";
import type {
  ClarityBuffer,
  ClarityStringAscii,
  ClarityStringUtf8,
} from "../types/primitives";

/**
 * Type guard for Clarity list type definitions
 */
export function isClarityList(type: ClarityType): type is ClarityListType {
  return typeof type === "object" && type !== null && "list" in type;
}

/**
 * Type guard for Clarity tuple type definitions
 */
export function isClarityTuple(type: ClarityType): type is ClarityTupleType {
  return typeof type === "object" && type !== null && "tuple" in type;
}

/**
 * Type guard for Clarity optional type definitions
 */
export function isClarityOptional(
  type: ClarityType
): type is ClarityOptionalType {
  return typeof type === "object" && type !== null && "optional" in type;
}

/**
 * Type guard for Clarity response type definitions
 */
export function isClarityResponse(
  type: ClarityType
): type is ClarityResponseType {
  return typeof type === "object" && type !== null && "response" in type;
}

/**
 * Type guard for Clarity buffer type definitions
 */
export function isClarityBuffer(type: ClarityType): type is ClarityBuffer {
  return typeof type === "object" && type !== null && "buff" in type;
}

/**
 * Type guard for Clarity string-ascii type definitions
 */
export function isClarityStringAscii(
  type: ClarityType
): type is ClarityStringAscii {
  return typeof type === "object" && type !== null && "string-ascii" in type;
}

/**
 * Type guard for Clarity string-utf8 type definitions
 */
export function isClarityStringUtf8(
  type: ClarityType
): type is ClarityStringUtf8 {
  return typeof type === "object" && type !== null && "string-utf8" in type;
}
