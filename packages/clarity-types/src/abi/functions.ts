import type { ClarityType } from "../types/composites";

/**
 * Contract function definitions
 */

export type FunctionAccess = "public" | "read-only" | "private";

export interface FunctionArg {
  name: string;
  type: ClarityType;
}

export interface ClarityFunction {
  name: string;
  access: FunctionAccess;
  args: ReadonlyArray<FunctionArg>;
  outputs: ClarityType;
}

/**
 * Clarity data variable definition
 */
export type VariableAccess = "constant" | "variable";

export interface ClarityVariable {
  name: string;
  type: ClarityType;
  access: VariableAccess;
}

/**
 * Clarity data map definition
 */
export interface ClarityMap {
  name: string;
  key: ClarityType;
  value: ClarityType;
}

export interface ClarityContract {
  functions: ReadonlyArray<ClarityFunction>;
  maps?: ReadonlyArray<ClarityMap>;
  variables?: ReadonlyArray<ClarityVariable>;
  // Future additions:
  // fungibleTokens?: ReadonlyArray<FungibleToken>
  // nonFungibleTokens?: ReadonlyArray<NonFungibleToken>
}

// Helper type to ensure const assertion
export type AsConst<T> = T extends ClarityContract ? T : never;
