import type { AbiType } from "./types.ts";
import type { ToCamelCase } from "./utils.ts";

type TupleToObject<
  T extends ReadonlyArray<{ name: string; type: AbiType }>,
> = {
  [K in T[number]["name"] as ToCamelCase<K>]: AbiToTS<
    Extract<T[number], { name: K }>["type"]
  >;
};

export type AbiToTS<T extends AbiType> = T extends "uint128"
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
                : T extends { list: { type: infer U extends AbiType } }
                  ? Array<AbiToTS<U>>
                  : T extends { optional: infer U extends AbiType }
                    ? AbiToTS<U> | null
                    : T extends {
                          response: {
                            ok: infer O extends AbiType;
                            error: infer E extends AbiType;
                          };
                        }
                      ? { ok: AbiToTS<O> } | { err: AbiToTS<E> }
                      : T extends {
                            tuple: infer Fields extends ReadonlyArray<{
                              name: string;
                              type: AbiType;
                            }>;
                          }
                        ? TupleToObject<Fields>
                        : never;

export type ResponseOk<T> = { ok: T };
export type ResponseErr<E> = { err: E };
export type Response<T, E> = ResponseOk<T> | ResponseErr<E>;
