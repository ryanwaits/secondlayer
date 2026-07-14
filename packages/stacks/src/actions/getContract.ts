import type {
	AbiContract,
	AbiFunction,
	AbiMap,
	AbiType,
	AbiTypesOf,
	ContractTypes,
	ExtractFunctionArgs,
	ExtractFunctionOutput,
	ExtractMapKey,
	ExtractMapNames,
	ExtractMapValue,
	ExtractPublicFunctions,
	ExtractReadOnlyFunctions,
} from "../clarity/abi/index.ts";
import { type ToCamelCase, toCamelCase } from "../clarity/abi/utils.ts";
import {
	clarityValueToJSUntyped,
	jsToClarityValue,
} from "../clarity/bridge.ts";
import type { ClarityValue } from "../clarity/types.ts";
import type { Client } from "../clients/types.ts";
import type { PostCondition } from "../postconditions/types.ts";
import { buildContractCall } from "../transactions/build.ts";
import type { StacksTransaction } from "../transactions/types.ts";
import { publicKeyToAddress } from "../utils/address.ts";
import type { IntegerType } from "../utils/encoding.ts";
import { estimateFee } from "./public/estimateFee.ts";
import { getMapEntry } from "./public/getMapEntry.ts";
import { readContract } from "./public/readContract.ts";
import { callContract } from "./wallet/callContract.ts";
import { resolveNonce } from "./wallet/nonceManager.ts";

// --- Type helpers for unwrapping response types ---

/**
 * Unwrap `(response ok err)` → just the `ok` branch type. Distributes over the
 * `{ ok } | { err }` union: the `err` branch maps to `never` (it throws
 * `ContractResponseError` at runtime, so it never reaches the caller).
 */
type UnwrapResponse<T> = T extends { ok: infer O }
	? O
	: T extends { err: unknown }
		? never
		: T;

type ReadMethodReturn<
	C extends AbiContract,
	N extends ExtractReadOnlyFunctions<C>,
> = UnwrapResponse<ExtractFunctionOutput<C, N>>;

// --- Public type for the contract instance ---

/**
 * When the ABI carries a codegen brand (`TypedAbi`), method types resolve to
 * the generated named aliases — cleaner hovers and error messages. Un-branded
 * ABIs fall back to structural inference over the as-const literal.
 */
type TypedReadMethods<T extends ContractTypes> = {
	[K in keyof T["functions"] as T["functions"][K]["access"] extends "read-only"
		? K
		: never]: (
		args: T["functions"][K]["args"],
	) => Promise<UnwrapResponse<T["functions"][K]["ret"]>>;
};

type TypedCallMethods<T extends ContractTypes> = {
	[K in keyof T["functions"] as T["functions"][K]["access"] extends "public"
		? K
		: never]: (
		args: T["functions"][K]["args"],
		options?: ContractCallOptions,
	) => Promise<string>;
};

type TypedMapMethods<T extends ContractTypes> = {
	[K in keyof NonNullable<T["maps"]>]: (
		key: NonNullable<T["maps"]>[K]["key"],
	) => Promise<NonNullable<T["maps"]>[K]["value"] | null>;
};

type ReadMethods<C extends AbiContract> = [AbiTypesOf<C>] extends [never]
	? {
			[N in ExtractReadOnlyFunctions<C> as ToCamelCase<N>]: (
				args: ExtractFunctionArgs<C, N>,
			) => Promise<ReadMethodReturn<C, N>>;
		}
	: TypedReadMethods<AbiTypesOf<C>>;

type CallMethods<C extends AbiContract> = [AbiTypesOf<C>] extends [never]
	? {
			[N in ExtractPublicFunctions<C> as ToCamelCase<N>]: (
				args: ExtractFunctionArgs<C, N>,
				options?: ContractCallOptions,
			) => Promise<string>;
		}
	: TypedCallMethods<AbiTypesOf<C>>;

type MapMethods<C extends AbiContract> = [AbiTypesOf<C>] extends [never]
	? {
			[N in ExtractMapNames<C> as ToCamelCase<N>]: (
				key: ExtractMapKey<C, N>,
			) => Promise<ExtractMapValue<C, N> | null>;
		}
	: TypedMapMethods<AbiTypesOf<C>>;

export type ContractCallOptions = {
	fee?: IntegerType;
	nonce?: IntegerType;
	postConditionMode?: "allow" | "deny";
	postConditions?: PostCondition[];
};

/**
 * Options for `buildCall.*` — building an unsigned transaction for
 * wallet-signs-later flows. `publicKey` defaults to the client account's
 * public key; `fee`/`nonce` are resolved from the network when omitted.
 */
export type ContractBuildCallOptions = ContractCallOptions & {
	publicKey?: string;
	sponsored?: boolean;
};

type TypedBuildCallMethods<T extends ContractTypes> = {
	[K in keyof T["functions"] as T["functions"][K]["access"] extends "public"
		? K
		: never]: (
		args: T["functions"][K]["args"],
		options?: ContractBuildCallOptions,
	) => Promise<StacksTransaction>;
};

type BuildCallMethods<C extends AbiContract> = [AbiTypesOf<C>] extends [never]
	? {
			[N in ExtractPublicFunctions<C> as ToCamelCase<N>]: (
				args: ExtractFunctionArgs<C, N>,
				options?: ContractBuildCallOptions,
			) => Promise<StacksTransaction>;
		}
	: TypedBuildCallMethods<AbiTypesOf<C>>;

export type ContractInstance<C extends AbiContract> = {
	read: ReadMethods<C>;
	call: CallMethods<C>;
	/** Build unsigned transactions (wallet-signs-later) — never broadcasts. */
	buildCall: BuildCallMethods<C>;
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

	const buildCall = new Proxy({} as BuildCallMethods<TAbi>, {
		get(_target, prop: string) {
			const fnName = camelToKebab.get(prop) ?? prop;
			const fn = fnByName.get(fnName);
			if (!fn || fn.access !== "public") return undefined;

			return async (
				args: Record<string, unknown>,
				options?: ContractBuildCallOptions,
			) => {
				const publicKey = options?.publicKey ?? client.account?.publicKey;
				if (!publicKey) {
					throw new Error(
						"buildCall requires a publicKey (pass options.publicKey or configure a client account)",
					);
				}

				const functionArgs = buildFunctionArgs(fn, args);
				const network = client.chain?.network ?? "mainnet";
				const nonce =
					options?.nonce ??
					(await resolveNonce(client, publicKeyToAddress(publicKey, network)));

				const unsigned = buildContractCall({
					contractAddress: address,
					contractName,
					functionName: fn.name,
					functionArgs,
					fee: options?.fee ?? 0n,
					nonce,
					publicKey,
					chain: client.chain,
					postConditionMode: options?.postConditionMode,
					postConditions: options?.postConditions,
					sponsored: options?.sponsored,
				});

				if (options?.fee === undefined) {
					const estimates = await estimateFee(client, {
						transaction: unsigned,
					});
					const mid = estimates[1] ?? estimates[0];
					if (mid) {
						// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
						(unsigned.auth.spendingCondition as any).fee = BigInt(mid.fee);
					}
				}

				return unsigned;
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

	return { read, call, buildCall, maps };
}

/**
 * Resolve a network-keyed contract config for the client's chain. The contracts
 * map is keyed by network ("mainnet" | "testnet"), so selection is a direct
 * index — no per-call ternary. Throws if the client has no chain configured.
 */
export function resolveNetworkContract<
	T extends Record<"mainnet" | "testnet", { address: string }>,
>(client: Client, contracts: T): T["mainnet"] | T["testnet"] {
	if (!client.chain) {
		throw new Error("Client must have a chain configured");
	}
	return contracts[client.chain.network];
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
		const value = hasOriginal
			? args[arg.name]
			: hasCamel
				? args[camelKey]
				: undefined;
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
