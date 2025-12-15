import type { ClarityType } from "./composites";
import type { ToCamelCase } from "../utils";

/**
 * Type mapping from Clarity types to TypeScript types
 */

type TupleToObject<
  T extends ReadonlyArray<{ name: string; type: ClarityType }>
> = {
  [K in T[number]["name"] as ToCamelCase<K>]: ClarityToTS<
    Extract<T[number], { name: K }>["type"]
  >;
};

export type ClarityToTS<T extends ClarityType> = T extends "uint128"
  ? bigint
  : T extends "int128"
  ? bigint
  : T extends "bool"
  ? boolean
  : T extends "principal"
  ? string
  : T extends "trait_reference"
  ? string
  : T extends { "string-ascii": any }
  ? string
  : T extends { "string-utf8": any }
  ? string
  : T extends { buff: any }
  ? Uint8Array
  : T extends { list: { type: infer U extends ClarityType } }
  ? Array<ClarityToTS<U>>
  : T extends { optional: infer U extends ClarityType }
  ? ClarityToTS<U> | null
  : T extends {
      response: {
        ok: infer O extends ClarityType;
        error: infer E extends ClarityType;
      };
    }
  ? { ok: ClarityToTS<O> } | { err: ClarityToTS<E> }
  : T extends {
      tuple: infer Fields extends ReadonlyArray<{
        name: string;
        type: ClarityType;
      }>;
    }
  ? TupleToObject<Fields>
  : never;

export type ResponseOk<T> = { ok: T };
export type ResponseErr<E> = { err: E };
export type Response<T, E> = ResponseOk<T> | ResponseErr<E>;
