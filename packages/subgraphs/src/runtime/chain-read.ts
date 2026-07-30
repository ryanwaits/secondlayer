import { getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import { http, createPublicClient } from "@secondlayer/stacks";
import {
	ContractResponseError,
	type UnwrapResponse,
	buildFunctionArgs,
	isResponseOutput,
	readContract,
} from "@secondlayer/stacks/actions";
import type { ClarityValue } from "@secondlayer/stacks/clarity";
import type {
	AbiContract,
	AbiFunction,
	AbiType,
	ExtractFunctionArgs,
	ExtractFunctionOutput,
	ExtractReadOnlyFunctions,
	ToCamelCase,
} from "@secondlayer/stacks/clarity";
import {
	clarityValueToJSUntyped,
	deserializeCV,
	normalizeAbi,
	serializeCV,
	toCamelCase,
} from "@secondlayer/stacks/clarity";
import type { Kysely } from "kysely";

/**
 * How long a read stays valid.
 *
 * - `per-block` (default): pinned to the block being processed, cached under
 *   its `index_block_hash`. Sound for any read-only function — reindexing the
 *   same block always returns the same value, and a reorg-replaced block has a
 *   different id so it can't inherit the orphaned answer.
 * - `contract-constant`: the caller asserts the value cannot change for this
 *   contract and these args (SIP-010 `get-decimals`/`get-symbol`), so it is
 *   resolved ONCE instead of once per block. This is the mode that makes a
 *   backfill affordable — under `per-block` every block is a distinct key and
 *   therefore a distinct RPC. Declaring it on a value that does change pins the
 *   first answer forever, so it is opt-in and never inferred.
 */
export type ChainReadCacheMode = "per-block" | "contract-constant";

export type ChainReadOptions = { cache?: ChainReadCacheMode };

/**
 * The chain-read surface, fully typed by an ABI.
 *
 * Shaped like `getContract` from `@secondlayer/stacks` — the same ABI in, the
 * same camelCased read methods out — minus `call`/`buildCall`: a handler
 * indexes the chain, it never writes to it.
 *
 * Reached through {@link readContractAt} rather than off `ctx.client`
 * directly: an ABI-generic method living on the context interface makes every
 * structural comparison of a subgraph definition instantiate it, which exceeds
 * TS's depth budget. At a call site the ABI is already concrete and it costs
 * nothing.
 */
export interface ChainReadClient {
	/**
	 * Read-only methods of a contract, evaluated against the exact block being
	 * processed.
	 *
	 * Every call is pinned to the block's `index_block_hash`, so a handler is a
	 * pure function of its block: reindexing a range produces byte-identical
	 * rows. Reading at the node's tip instead would make the same reindex
	 * return different values — that is the corruption this refuses to allow,
	 * so a block whose id was never persisted throws rather than falling back.
	 *
	 * Results are memoized in Postgres, so a value is fetched once per block
	 * rather than once per event (or once per contract with
	 * `cache: "contract-constant"`).
	 */
	contract<const C extends AbiContract>(
		contractId: string,
		abi: C,
		options?: ChainReadOptions,
	): { read: ChainReadMethods<C> };
}

/**
 * The camelCased read methods of an ABI. Spelled out rather than reused from
 * `ContractInstance<C>["read"]`: that type is a conditional over the codegen
 * brand, and evaluating it wherever a subgraph definition is structurally
 * compared pushes TS past its instantiation depth.
 */
export type ChainReadMethods<C extends AbiContract> = {
	[N in ExtractReadOnlyFunctions<C> as ToCamelCase<N>]: (
		args: ExtractFunctionArgs<C, N>,
	) => Promise<UnwrapResponse<ExtractFunctionOutput<C, N>>>;
};

/**
 * `ChainReadClient` with the ABI generic erased. Structurally cheap, so the
 * base `SubgraphContext` can carry it; `TypedSubgraphContext` uses the real
 * one and handlers get full inference.
 */
export interface ErasedChainReadClient {
	// `abi: unknown`, not `AbiContract`: naming the ABI type here drags its
	// (deeply recursive) definition into every structural comparison of a
	// subgraph definition. `readContractAt` constrains it properly.
	contract(
		contractId: string,
		abi: unknown,
		options?: ChainReadOptions,
	): {
		read: Record<string, (args?: Record<string, unknown>) => Promise<unknown>>;
	};
}

/**
 * Typed read methods for one contract, from a handler.
 *
 * ```ts
 * const token = readContractAt(ctx, contractId, SIP010_ABI, {
 *   cache: "contract-constant",
 * });
 * const decimals = await token.read.getDecimals({}); // bigint
 * ```
 */
export function readContractAt<const C extends AbiContract>(
	ctx: { client: ErasedChainReadClient },
	contractId: string,
	abi: C,
	options?: ChainReadOptions,
): { read: ChainReadMethods<C> } {
	return ctx.client.contract(contractId, abi, options) as unknown as {
		read: ChainReadMethods<C>;
	};
}

export class ChainReadError extends Error {
	override name = "ChainReadError";
}

/**
 * Node transport for handler reads. Deliberately its own client rather than a
 * shared singleton: `retryCount: 0` keeps a slow node from multiplying into the
 * block's retry budget (`processBlockWithRetry` already owns retries), and the
 * concurrency gate below bounds how much of a backfill can hit the node at once.
 */
function nodeClient(rpcUrl: string) {
	return createPublicClient({
		transport: http(rpcUrl, { retryCount: 0, timeout: 10_000 }),
	});
}

/**
 * Cap concurrent node reads across all handlers in this process. A handler that
 * reads on every event turns a 100-block batch into thousands of in-flight
 * requests otherwise — enough to knock over the node the indexer depends on.
 */
class ConcurrencyGate {
	private active = 0;
	private queue: Array<() => void> = [];

	constructor(private readonly limit: number) {}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		if (this.active >= this.limit) {
			await new Promise<void>((resolve) => this.queue.push(resolve));
		}
		this.active++;
		try {
			return await fn();
		} finally {
			this.active--;
			this.queue.shift()?.();
		}
	}
}

const DEFAULT_MAX_CONCURRENT_READS = 4;

function maxConcurrentReads(): number {
	const raw = process.env.SUBGRAPH_CHAIN_READ_CONCURRENCY;
	const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: DEFAULT_MAX_CONCURRENT_READS;
}

const gate = new ConcurrencyGate(maxConcurrentReads());

/** Stable key for an arg set — property order must not fork a cache entry. */
function hashArgs(args: readonly ClarityValue[]): string {
	const serialized = args.map((arg) => serializeCV(arg)).join(",");
	return Bun.hash(serialized).toString(16);
}

function findFunction(abi: AbiContract, name: string): AbiFunction {
	const fn = abi.functions.find((f) => f.name === name) as
		| AbiFunction
		| undefined;
	if (!fn) {
		throw new ChainReadError(`No function "${name}" in the supplied ABI.`);
	}
	if (fn.access !== "read-only") {
		throw new ChainReadError(
			`"${name}" is ${fn.access}, not read-only — a handler cannot call it.`,
		);
	}
	return fn;
}

export type ChainReadContext = {
	blockHeight: number;
	indexBlockHash: string | null | undefined;
	rpcUrl?: string;
	db?: Kysely<Database>;
};

/**
 * Build the `ctx.client` surface for one block. Generic lives on the METHOD,
 * not here, so a handler's ABI narrows per call without infecting
 * `SubgraphContext` with a type parameter.
 */
/**
 * Build the `ctx.client` surface for one block. The ABI generic lives on
 * `contract()`, not here, so a handler's types narrow per contract without
 * `SubgraphContext` carrying a type parameter.
 */
export function createChainReadClient(ctx: ChainReadContext): ChainReadClient {
	// The ABI generic is erased inside the implementation on purpose:
	// re-resolving `ExtractFunctionArgs` against an unfixed type parameter is
	// what pushes TS past its instantiation depth on a real-sized ABI.
	const readValue = async (
		contractId: string,
		abi: AbiContract,
		functionName: string,
		args: Record<string, unknown>,
		options: ChainReadOptions,
	): Promise<unknown> => {
		const rpcUrl = ctx.rpcUrl ?? process.env.STACKS_NODE_RPC_URL;
		if (!rpcUrl) {
			throw new ChainReadError(
				"ctx.client needs a Stacks node: set STACKS_NODE_RPC_URL on the subgraph processor.",
			);
		}

		const constant = options.cache === "contract-constant";
		if (!constant && !ctx.indexBlockHash) {
			throw new ChainReadError(
				`Block ${ctx.blockHeight} has no index_block_hash, so a read cannot be pinned to it. Reading at the node's tip would make this handler non-deterministic (the same reindex would produce different rows). Re-ingest the block, or pass cache: "contract-constant" if the value genuinely cannot change.`,
			);
		}

		const fn = findFunction(abi, functionName);
		const clarityArgs = buildFunctionArgs(fn, args);
		const db = ctx.db ?? getSourceDb();
		const argsHash = hashArgs(clarityArgs);
		const pinnedTo = constant ? null : (ctx.indexBlockHash as string);

		const cached = await db
			.selectFrom("chain_read_cache")
			.select("result_hex")
			.where("contract_id", "=", contractId)
			.where("function_name", "=", fn.name)
			.where("args_hash", "=", argsHash)
			.where((eb) =>
				pinnedTo === null
					? eb("index_block_hash", "is", null)
					: eb("index_block_hash", "=", pinnedTo),
			)
			.executeTakeFirst();

		const resultHex =
			cached?.result_hex ??
			(await gate.run(async () => {
				// A constant read still pins to this block where it can: "cannot
				// change" is a claim about future blocks, not a license to read
				// a tip that may be ahead of the one being processed.
				if (!ctx.indexBlockHash) {
					// The one path where an UNPINNED read happens. Reachable only
					// in constant mode on a block with no persisted id — which is
					// exactly what the pinning error tells you to do — so it is
					// allowed, but never silently.
					logger.warn(
						"Chain read is not pinned to a block (no index_block_hash)",
						{
							contractId,
							functionName: fn.name,
							blockHeight: ctx.blockHeight,
							note: 'cache: "contract-constant" asserts this value cannot change; the node answered at its own tip',
						},
					);
				}
				const value = await readContract(nodeClient(rpcUrl), {
					contract: contractId,
					functionName: fn.name,
					args: clarityArgs,
					tip: ctx.indexBlockHash ?? undefined,
				});
				return serializeCV(value);
			}));

		if (!cached) {
			await db
				.insertInto("chain_read_cache")
				.values({
					contract_id: contractId,
					function_name: fn.name,
					args_hash: argsHash,
					index_block_hash: pinnedTo,
					block_height: constant ? null : ctx.blockHeight,
					result_hex: resultHex,
				})
				// Two handlers in the same batch can race to the same key; the
				// value is identical either way, so the loser keeps its own.
				.onConflict((oc) => oc.doNothing())
				.execute();
		}

		const value = deserializeCV(resultHex);
		const js = clarityValueToJSUntyped(fn.outputs as AbiType, value);

		if (isResponseOutput(fn.outputs as AbiType)) {
			const response = js as { ok?: unknown; err?: unknown };
			if ("ok" in response) return response.ok;
			throw new ContractResponseError(
				`${contractId}::${fn.name} returned an err response.`,
				response.err,
			);
		}
		return js;
	};

	return {
		contract(contractId: string, rawAbi: AbiContract, options = {}) {
			// Accept a raw Hiro/Clarinet ABI as well as a normalized one — raw
			// ABIs wrap `outputs` as `{ type: … }`, which the JS bridge can't read.
			const abi = normalizeAbi(rawAbi);
			const camelToKebab = new Map<string, string>();
			for (const fn of abi.functions) {
				camelToKebab.set(toCamelCase(fn.name), fn.name);
			}

			const read = new Proxy(
				{},
				{
					get(_target, prop: string) {
						const fnName = camelToKebab.get(prop) ?? prop;
						return (args: Record<string, unknown> = {}) =>
							readValue(contractId, abi, fnName, args, options);
					},
				},
			);

			return { read } as never;
		},
	};
}
