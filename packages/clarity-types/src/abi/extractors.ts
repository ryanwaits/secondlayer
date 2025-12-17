import type { ClarityContract, FunctionAccess, VariableAccess } from "./functions";
import type { ClarityToTS } from "../types/mappings";
import type { ClarityType } from "../types/composites";
import type { ToCamelCase } from "../utils";

/**
 * Type extraction utilities for contract ABIs
 */

export type ExtractFunctionNames<
  C extends ClarityContract,
  Access extends FunctionAccess = FunctionAccess
> = Extract<C["functions"][number], { access: Access }>["name"];

export type ExtractFunction<
  C extends ClarityContract,
  N extends ExtractFunctionNames<C>
> = Extract<C["functions"][number], { name: N }>;

export type ExtractFunctionArgs<
  C extends ClarityContract,
  N extends ExtractFunctionNames<C>
> = ExtractFunction<C, N> extends {
  args: infer Args extends ReadonlyArray<{ name: string; type: any }>;
}
  ? {
      [K in Args[number]["name"] as ToCamelCase<K>]: ClarityToTS<
        Extract<Args[number], { name: K }>["type"]
      >;
    }
  : never;

export type ExtractFunctionArgsTuple<
  C extends ClarityContract,
  N extends ExtractFunctionNames<C>
> = ExtractFunction<C, N> extends {
  args: infer Args extends ReadonlyArray<{ type: any }>;
}
  ? {
      [K in keyof Args]: Args[K] extends { type: infer T extends ClarityType }
        ? ClarityToTS<T>
        : never;
    }
  : never;

export type ExtractFunctionOutput<
  C extends ClarityContract,
  N extends ExtractFunctionNames<C>
> = ExtractFunction<C, N> extends { outputs: infer O extends ClarityType }
  ? ClarityToTS<O>
  : never;

export type ExtractPublicFunctions<C extends ClarityContract> =
  ExtractFunctionNames<C, "public">;

export type ExtractReadOnlyFunctions<C extends ClarityContract> =
  ExtractFunctionNames<C, "read-only">;

// ============================================================================
// Private Functions Extractor
// ============================================================================

export type ExtractPrivateFunctions<C extends ClarityContract> =
  ExtractFunctionNames<C, "private">;

// ============================================================================
// Map Extractors
// ============================================================================

export type ExtractMapNames<C extends ClarityContract> =
  C["maps"] extends ReadonlyArray<{ name: infer N extends string }>
    ? N
    : never;

export type ExtractMap<
  C extends ClarityContract,
  N extends ExtractMapNames<C>
> = C["maps"] extends ReadonlyArray<infer M>
  ? Extract<M, { name: N }>
  : never;

export type ExtractMapKey<
  C extends ClarityContract,
  N extends ExtractMapNames<C>
> = ExtractMap<C, N> extends { key: infer K extends ClarityType }
  ? ClarityToTS<K>
  : never;

export type ExtractMapValue<
  C extends ClarityContract,
  N extends ExtractMapNames<C>
> = ExtractMap<C, N> extends { value: infer V extends ClarityType }
  ? ClarityToTS<V>
  : never;

// ============================================================================
// Variable Extractors
// ============================================================================

export type ExtractVariableNames<
  C extends ClarityContract,
  Access extends VariableAccess = VariableAccess
> = C["variables"] extends ReadonlyArray<infer V>
  ? V extends { name: infer N extends string; access: Access }
    ? N
    : never
  : never;

export type ExtractVariable<
  C extends ClarityContract,
  N extends ExtractVariableNames<C>
> = C["variables"] extends ReadonlyArray<infer V>
  ? Extract<V, { name: N }>
  : never;

export type ExtractVariableType<
  C extends ClarityContract,
  N extends ExtractVariableNames<C>
> = ExtractVariable<C, N> extends { type: infer T extends ClarityType }
  ? ClarityToTS<T>
  : never;

export type ExtractConstants<C extends ClarityContract> =
  ExtractVariableNames<C, "constant">;

export type ExtractDataVars<C extends ClarityContract> =
  ExtractVariableNames<C, "variable">;

// ============================================================================
// Token Extractors
// ============================================================================

export type ExtractFungibleTokenNames<C extends ClarityContract> =
  C["fungible_tokens"] extends ReadonlyArray<{ name: infer N extends string }>
    ? N
    : never;

export type ExtractNonFungibleTokenNames<C extends ClarityContract> =
  C["non_fungible_tokens"] extends ReadonlyArray<{ name: infer N extends string }>
    ? N
    : never;

export type ExtractNFTAssetType<
  C extends ClarityContract,
  N extends ExtractNonFungibleTokenNames<C>
> = C["non_fungible_tokens"] extends ReadonlyArray<infer T>
  ? Extract<T, { name: N }> extends { type: infer A extends ClarityType }
    ? ClarityToTS<A>
    : never
  : never;

// ============================================================================
// Trait Extractors
// ============================================================================

export type ExtractDefinedTraitNames<C extends ClarityContract> =
  C["defined_traits"] extends ReadonlyArray<{ name: infer N extends string }>
    ? N
    : never;

export type ExtractImplementedTraits<C extends ClarityContract> =
  C["implemented_traits"] extends ReadonlyArray<infer T extends string>
    ? T
    : never;
