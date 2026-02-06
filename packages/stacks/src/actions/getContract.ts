import type { Client } from "../clients/types.ts";
import type {
  AbiContract,
  AbiFunction,
  AbiMap,
  AbiType,
  ExtractReadOnlyFunctions,
  ExtractPublicFunctions,
  ExtractFunctionArgs,
  ExtractFunctionOutput,
  ExtractMapNames,
  ExtractMapKey,
  ExtractMapValue,
} from "../clarity/abi/index.ts";
import { toCamelCase } from "../clarity/abi/utils.ts";
import { jsToClarityValue, clarityValueToJSUntyped } from "../clarity/bridge.ts";
import { readContract } from "./public/readContract.ts";
import { callContract } from "./wallet/callContract.ts";
import { getMapEntry } from "./public/getMapEntry.ts";
import type { ClarityValue } from "../clarity/types.ts";
import type { PostCondition } from "../postconditions/types.ts";
import type { IntegerType } from "../utils/encoding.ts";

// --- Type helpers for unwrapping response types ---

/** Unwrap `(response ok err)` → just the `ok` branch type */
type UnwrapResponse<T> = T extends { ok: infer O } | { err: any } ? O : T;

type ReadMethodReturn<
  C extends AbiContract,
  N extends ExtractReadOnlyFunctions<C>,
> = UnwrapResponse<ExtractFunctionOutput<C, N>>;

// --- Public type for the contract instance ---

type ReadMethods<C extends AbiContract> = {
  [N in ExtractReadOnlyFunctions<C> as ToCamelCaseName<N>]: (
    args: ExtractFunctionArgs<C, N>,
  ) => Promise<ReadMethodReturn<C, N>>;
};

type CallMethods<C extends AbiContract> = {
  [N in ExtractPublicFunctions<C> as ToCamelCaseName<N>]: (
    args: ExtractFunctionArgs<C, N>,
    options?: ContractCallOptions,
  ) => Promise<string>;
};

type MapMethods<C extends AbiContract> = {
  [N in ExtractMapNames<C> as ToCamelCaseName<N>]: (
    key: ExtractMapKey<C, N>,
  ) => Promise<ExtractMapValue<C, N> | null>;
};

type ToCamelCaseName<S extends string> = S extends string
  ? ReturnType<typeof toCamelCase> extends string
    ? S
    : S
  : S;

export type ContractCallOptions = {
  fee?: IntegerType;
  nonce?: IntegerType;
  postConditionMode?: "allow" | "deny";
  postConditions?: PostCondition[];
};

export type ContractInstance<C extends AbiContract> = {
  read: ReadMethods<C>;
  call: CallMethods<C>;
  maps: MapMethods<C>;
};

export type GetContractParams<C extends AbiContract> = {
  client: Client;
  address: string;
  name: string;
  abi: C;
};

export function getContract<const TAbi extends AbiContract>(
  params: GetContractParams<TAbi>,
): ContractInstance<TAbi> {
  const { client, address, name: contractName, abi } = params;
  const contractId = `${address}.${contractName}`;

  // Index functions/maps by name for fast lookup
  const fnByName = new Map<string, AbiFunction>();
  for (const fn of abi.functions) {
    fnByName.set(fn.name, fn as AbiFunction);
  }

  const mapByName = new Map<string, AbiMap>();
  if (abi.maps) {
    for (const m of abi.maps) {
      mapByName.set(m.name, m as AbiMap);
    }
  }

  // Build kebab→camel reverse map for function/map names
  const camelToKebab = new Map<string, string>();
  for (const fn of abi.functions) {
    camelToKebab.set(toCamelCase(fn.name), fn.name);
  }
  if (abi.maps) {
    for (const m of abi.maps) {
      camelToKebab.set(toCamelCase(m.name), m.name);
    }
  }

  const read = new Proxy({} as ReadMethods<TAbi>, {
    get(_target, prop: string) {
      const fnName = camelToKebab.get(prop) ?? prop;
      const fn = fnByName.get(fnName);
      if (!fn || fn.access !== "read-only") return undefined;

      return async (args: Record<string, unknown>) => {
        const clarityArgs = buildFunctionArgs(fn, args);
        const result = await readContract(client, {
          contract: contractId,
          functionName: fn.name,
          args: clarityArgs,
        });

        const jsValue = clarityValueToJSUntyped(fn.outputs as AbiType, result);

        // Auto-unwrap: if output is response type, unwrap ok / throw on err
        if (isResponseOutput(fn.outputs as AbiType)) {
          const resp = jsValue as { ok?: unknown; err?: unknown };
          if ("ok" in resp) return resp.ok;
          throw new ContractResponseError(
            `${contractId}::${fn.name} returned (err ${formatErrValue(resp.err)})`,
            resp.err,
          );
        }

        return jsValue;
      };
    },
  });

  const call = new Proxy({} as CallMethods<TAbi>, {
    get(_target, prop: string) {
      const fnName = camelToKebab.get(prop) ?? prop;
      const fn = fnByName.get(fnName);
      if (!fn || fn.access !== "public") return undefined;

      return async (
        args: Record<string, unknown>,
        options?: ContractCallOptions,
      ) => {
        const clarityArgs = buildFunctionArgs(fn, args);
        return callContract(client, {
          contract: contractId,
          functionName: fn.name,
          functionArgs: clarityArgs,
          ...options,
        });
      };
    },
  });

  const maps = new Proxy({} as MapMethods<TAbi>, {
    get(_target, prop: string) {
      const mapName = camelToKebab.get(prop) ?? prop;
      const map = mapByName.get(mapName);
      if (!map) return undefined;

      return async (key: unknown) => {
        const clarityKey = jsToClarityValue(map.key as AbiType, key);
        const result = await getMapEntry(client, {
          contract: contractId,
          mapName: map.name,
          key: clarityKey,
        });

        // Map entries come back as (optional ...). If none, return null.
        if (result.type === "none") return null;
        if (result.type === "some") {
          return clarityValueToJSUntyped(map.value as AbiType, result.value);
        }
        // Direct value (shouldn't normally happen, but handle gracefully)
        return clarityValueToJSUntyped(map.value as AbiType, result);
      };
    },
  });

  return { read, call, maps };
}

// --- Helpers ---

function buildFunctionArgs(
  fn: AbiFunction,
  args: Record<string, unknown>,
): ClarityValue[] {
  return fn.args.map((arg) => {
    const camelKey = toCamelCase(arg.name);
    const hasOriginal = arg.name in args;
    const hasCamel = camelKey in args;
    const value = hasOriginal ? args[arg.name] : hasCamel ? args[camelKey] : undefined;
    if (value === undefined) throw new Error(`Missing argument: ${arg.name}`);
    return jsToClarityValue(arg.type as AbiType, value);
  });
}

function isResponseOutput(type: AbiType): boolean {
  return typeof type === "object" && type !== null && "response" in type;
}

function formatErrValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

export class ContractResponseError extends Error {
  override name = "ContractResponseError";
  constructor(
    message: string,
    public readonly errorValue: unknown,
  ) {
    super(message);
  }
}
