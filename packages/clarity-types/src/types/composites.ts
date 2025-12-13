import type { ClarityPrimitiveType } from "./primitives";

/**
 * Clarity composite types
 */

// Use interface for recursive type definition
export interface ClarityListType {
  list: {
    type: ClarityType;
    length: number;
  };
}

export interface ClarityTupleType {
  tuple: ReadonlyArray<{
    name: string;
    type: ClarityType;
  }>;
}

export interface ClarityOptionalType {
  optional: ClarityType;
}

export interface ClarityResponseType {
  response: {
    ok: ClarityType;
    error: ClarityType;
  };
}

export type ClarityType =
  | ClarityPrimitiveType
  | ClarityListType
  | ClarityTupleType
  | ClarityOptionalType
  | ClarityResponseType;

// Generic versions for better type inference
export type ClarityList<
  T extends ClarityType = ClarityType,
  L extends number = number
> = {
  list: {
    type: T;
    length: L;
  };
};

export type ClarityTuple<
  T extends ReadonlyArray<{ name: string; type: ClarityType }>
> = {
  tuple: T;
};

export type ClarityOptional<T extends ClarityType = ClarityType> = {
  optional: T;
};

export type ClarityResponse<
  O extends ClarityType = ClarityType,
  E extends ClarityType = ClarityType
> = {
  response: {
    ok: O;
    error: E;
  };
};
