/**
 * Clarity primitive types
 */

export type ClarityUInt128 = "uint128";
export type ClarityInt128 = "int128";

export type ClarityBool = "bool";

export type ClarityPrincipal = "principal";

export type ClarityTraitReference = "trait_reference";

export type ClarityStringAscii<L extends number = number> = {
  "string-ascii": {
    length: L;
  };
};

export type ClarityStringUtf8<L extends number = number> = {
  "string-utf8": {
    length: L;
  };
};

export type ClarityBuffer<L extends number = number> = {
  buff: {
    length: L;
  };
};

export type ClarityPrimitiveType =
  | ClarityUInt128
  | ClarityInt128
  | ClarityBool
  | ClarityPrincipal
  | ClarityTraitReference
  | ClarityStringAscii
  | ClarityStringUtf8
  | ClarityBuffer;

export const MAX_U128 = 2n ** 128n - 1n;
export const MAX_I128 = 2n ** 127n - 1n;
export const MIN_I128 = -(2n ** 127n);

// Contract name validation regex (used after address validation)
export const CONTRACT_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9\-]{0,127}$/;
