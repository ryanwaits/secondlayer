import type { AbiContract, FunctionAccess, VariableAccess } from "./contract.ts";
import type { AbiToTS } from "./mappings.ts";
import type { AbiType } from "./types.ts";
import type { ToCamelCase } from "./utils.ts";

// Function extractors

export type ExtractFunctionNames<
  C extends AbiContract,
  Access extends FunctionAccess = FunctionAccess,
> = Extract<C["functions"][number], { access: Access }>["name"];

export type ExtractFunction<
  C extends AbiContract,
  N extends ExtractFunctionNames<C>,
> = Extract<C["functions"][number], { name: N }>;

export type ExtractFunctionArgs<
  C extends AbiContract,
  N extends ExtractFunctionNames<C>,
> = ExtractFunction<C, N> extends {
  args: infer Args extends ReadonlyArray<{ name: string; type: any }>;
}
  ? {
      [K in Args[number]["name"] as ToCamelCase<K>]: AbiToTS<
        Extract<Args[number], { name: K }>["type"]
      >;
    }
  : never;

export type ExtractFunctionOutput<
  C extends AbiContract,
  N extends ExtractFunctionNames<C>,
> = ExtractFunction<C, N> extends { outputs: infer O extends AbiType }
  ? AbiToTS<O>
  : never;

export type ExtractPublicFunctions<C extends AbiContract> =
  ExtractFunctionNames<C, "public">;

export type ExtractReadOnlyFunctions<C extends AbiContract> =
  ExtractFunctionNames<C, "read-only">;

export type ExtractPrivateFunctions<C extends AbiContract> =
  ExtractFunctionNames<C, "private">;

// Map extractors

export type ExtractMapNames<C extends AbiContract> =
  C["maps"] extends ReadonlyArray<{ name: infer N extends string }>
    ? N
    : never;

export type ExtractMap<
  C extends AbiContract,
  N extends ExtractMapNames<C>,
> = C["maps"] extends ReadonlyArray<infer M>
  ? Extract<M, { name: N }>
  : never;

export type ExtractMapKey<
  C extends AbiContract,
  N extends ExtractMapNames<C>,
> = ExtractMap<C, N> extends { key: infer K extends AbiType }
  ? AbiToTS<K>
  : never;

export type ExtractMapValue<
  C extends AbiContract,
  N extends ExtractMapNames<C>,
> = ExtractMap<C, N> extends { value: infer V extends AbiType }
  ? AbiToTS<V>
  : never;

// Variable extractors

export type ExtractVariableNames<
  C extends AbiContract,
  Access extends VariableAccess = VariableAccess,
> = C["variables"] extends ReadonlyArray<infer V>
  ? V extends { name: infer N extends string; access: Access }
    ? N
    : never
  : never;

export type ExtractVariable<
  C extends AbiContract,
  N extends ExtractVariableNames<C>,
> = C["variables"] extends ReadonlyArray<infer V>
  ? Extract<V, { name: N }>
  : never;

export type ExtractVariableType<
  C extends AbiContract,
  N extends ExtractVariableNames<C>,
> = ExtractVariable<C, N> extends { type: infer T extends AbiType }
  ? AbiToTS<T>
  : never;

export type ExtractConstants<C extends AbiContract> =
  ExtractVariableNames<C, "constant">;

export type ExtractDataVars<C extends AbiContract> =
  ExtractVariableNames<C, "variable">;

// Token extractors

export type ExtractFungibleTokenNames<C extends AbiContract> =
  C["fungible_tokens"] extends ReadonlyArray<{ name: infer N extends string }>
    ? N
    : never;

export type ExtractNonFungibleTokenNames<C extends AbiContract> =
  C["non_fungible_tokens"] extends ReadonlyArray<{
    name: infer N extends string;
  }>
    ? N
    : never;

export type ExtractNFTAssetType<
  C extends AbiContract,
  N extends ExtractNonFungibleTokenNames<C>,
> = C["non_fungible_tokens"] extends ReadonlyArray<infer T>
  ? Extract<T, { name: N }> extends { type: infer A extends AbiType }
    ? AbiToTS<A>
    : never
  : never;

// Trait extractors

export type ExtractDefinedTraitNames<C extends AbiContract> =
  C["defined_traits"] extends ReadonlyArray<{ name: infer N extends string }>
    ? N
    : never;

export type ExtractImplementedTraits<C extends AbiContract> =
  C["implemented_traits"] extends ReadonlyArray<infer T extends string>
    ? T
    : never;
