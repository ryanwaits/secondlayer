import { MAX_U128, MAX_I128, MIN_I128 } from "../../utils/constants.ts";

export { MAX_U128, MAX_I128, MIN_I128 };

export const CONTRACT_NAME_REGEX: RegExp = /^[a-zA-Z][a-zA-Z0-9\-]{0,127}$/;

// Primitive types

export type AbiUInt128 = "uint128";
export type AbiInt128 = "int128";
export type AbiBool = "bool";
export type AbiPrincipal = "principal";
export type AbiTraitReference = "trait_reference";
export type AbiNone = "none";

export type AbiStringAscii<L extends number = number> = {
  "string-ascii": { length: L };
};

export type AbiStringUtf8<L extends number = number> = {
  "string-utf8": { length: L };
};

export type AbiBuffer<L extends number = number> = {
  buff: { length: L };
};

export type AbiPrimitiveType =
  | AbiUInt128
  | AbiInt128
  | AbiBool
  | AbiPrincipal
  | AbiTraitReference
  | AbiNone
  | AbiStringAscii
  | AbiStringUtf8
  | AbiBuffer;

// Composite types (interfaces for recursion)

export interface AbiListType {
  list: { type: AbiType; length: number };
}

export interface AbiTupleType {
  tuple: ReadonlyArray<{ name: string; type: AbiType }>;
}

export interface AbiOptionalType {
  optional: AbiType;
}

export interface AbiResponseType {
  response: { ok: AbiType; error: AbiType };
}

/** Discriminated union of all Clarity value types (primitives, buffers, lists, tuples, optionals, responses). */
export type AbiType =
  | AbiPrimitiveType
  | AbiListType
  | AbiTupleType
  | AbiOptionalType
  | AbiResponseType;

// Generic versions for better type inference

export type AbiList<
  T extends AbiType = AbiType,
  L extends number = number,
> = {
  list: { type: T; length: L };
};

export type AbiTuple<
  T extends ReadonlyArray<{ name: string; type: AbiType }>,
> = {
  tuple: T;
};

export type AbiOptional<T extends AbiType = AbiType> = {
  optional: T;
};

export type AbiResponse<
  O extends AbiType = AbiType,
  E extends AbiType = AbiType,
> = {
  response: { ok: O; error: E };
};
