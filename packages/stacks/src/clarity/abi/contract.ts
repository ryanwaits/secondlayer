import type { AbiType } from "./types.ts";

export type FunctionAccess = "public" | "read-only" | "private";

export interface FunctionArg {
  name: string;
  type: AbiType;
}

export interface AbiFunction {
  name: string;
  access: FunctionAccess;
  args: ReadonlyArray<FunctionArg>;
  outputs: AbiType;
}

export type VariableAccess = "constant" | "variable";

export interface AbiVariable {
  name: string;
  type: AbiType;
  access: VariableAccess;
}

export interface AbiMap {
  name: string;
  key: AbiType;
  value: AbiType;
}

export interface AbiFungibleToken {
  name: string;
}

export interface AbiNonFungibleToken {
  name: string;
  type: AbiType;
}

export type TraitFunctionAccess = Exclude<FunctionAccess, "private">;

export interface AbiTraitFunction {
  name: string;
  access: TraitFunctionAccess;
  args: ReadonlyArray<FunctionArg>;
  outputs: AbiType;
}

export interface AbiTraitDefinition {
  name: string;
  functions: ReadonlyArray<AbiTraitFunction>;
}

export interface AbiContract {
  functions: ReadonlyArray<AbiFunction>;
  maps?: ReadonlyArray<AbiMap>;
  variables?: ReadonlyArray<AbiVariable>;
  fungible_tokens?: ReadonlyArray<AbiFungibleToken>;
  non_fungible_tokens?: ReadonlyArray<AbiNonFungibleToken>;
  implemented_traits?: ReadonlyArray<string>;
  defined_traits?: ReadonlyArray<AbiTraitDefinition>;
}
