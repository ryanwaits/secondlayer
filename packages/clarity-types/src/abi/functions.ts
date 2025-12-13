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

export interface ClarityContract {
  functions: ReadonlyArray<ClarityFunction>;
  // TODO:
  // Future additions:
  // maps?: ReadonlyArray<ClarityMap>
  // variables?: ReadonlyArray<ClarityVariable>
  // fungibleTokens?: ReadonlyArray<FungibleToken>
  // nonFungibleTokens?: ReadonlyArray<NonFungibleToken>
}

// Helper type to ensure const assertion
export type AsConst<T> = T extends ClarityContract ? T : never;
