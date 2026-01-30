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

/**
 * Clarity fungible token definition (define-fungible-token)
 */
export interface ClarityFungibleToken {
  name: string;
}

/**
 * Clarity non-fungible token definition (define-non-fungible-token)
 */
export interface ClarityNonFungibleToken {
  name: string;
  type: ClarityType;
}

/**
 * Trait function signature (used in define-trait)
 */
export type TraitFunctionAccess = Exclude<FunctionAccess, "private">;

export interface ClarityTraitFunction {
  name: string;
  access: TraitFunctionAccess;
  args: ReadonlyArray<FunctionArg>;
  outputs: ClarityType;
}

/**
 * Clarity trait definition (define-trait)
 */
export interface ClarityTraitDefinition {
  name: string;
  functions: ReadonlyArray<ClarityTraitFunction>;
}

export interface ClarityContract {
  functions: ReadonlyArray<ClarityFunction>;
  maps?: ReadonlyArray<ClarityMap>;
  variables?: ReadonlyArray<ClarityVariable>;
  fungible_tokens?: ReadonlyArray<ClarityFungibleToken>;
  non_fungible_tokens?: ReadonlyArray<ClarityNonFungibleToken>;
  implemented_traits?: ReadonlyArray<string>;
  defined_traits?: ReadonlyArray<ClarityTraitDefinition>;
}
