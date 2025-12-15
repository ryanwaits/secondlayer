import type { ClarityContract, FunctionAccess } from "./functions";
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
