import { getErrorMessage } from "@secondlayer/shared";
import { getSourceDb } from "@secondlayer/shared/db";
import { hasNoLocalChain } from "@secondlayer/shared/db/queries/instance";
import type { Database } from "@secondlayer/shared/db/schema";
import { logger } from "@secondlayer/shared/logger";
import {
	http,
	ReadContractError,
	createPublicClient,
} from "@secondlayer/stacks";
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
import { HandlerReadError } from "./realm.ts";

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

/** Options for a contract read, such as cache mode. */
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
 * True for a structural empty mapped type (`{}`) and for codegen's
 * `Record<string, never>`. `keyof Record<string, never>` is `string`, so the
 * first check alone is not enough. Local copy of the `getContract` helper —
 * importing `ContractInstance<C>["read"]` would re-enter the codegen-brand
 * conditional this type exists to avoid.
 */
type IsEmptyArgs<A> = [keyof A & string] extends [never]
	? true
	: Record<string, never> extends A
		? true
		: false;

type ChainReadMethod<A, R> = IsEmptyArgs<A> extends true
	? (args?: A) => R
	: (args: A) => R;

/**
 * The camelCased read methods of an ABI. Spelled out rather than reused from
 * `ContractInstance<C>["read"]`: that type is a conditional over the codegen
 * brand, and evaluating it wherever a subgraph definition is structurally
 * compared pushes TS past its instantiation depth.
 */
export type ChainReadMethods<C extends AbiContract> = {
	[N in ExtractReadOnlyFunctions<C> as ToCamelCase<N>]: ChainReadMethod<
		ExtractFunctionArgs<C, N>,
		Promise<UnwrapResponse<ExtractFunctionOutput<C, N>>>
	>;
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
	/**
	 * Reads a contract's read-only functions at the block being processed.
	 *
	 * Results are untyped here. Call it through `readContractAt` to get typed
	 * results from the contract's ABI.
	 */
	contract(
		contractId: string,
		abi: unknown,
		options?: ChainReadOptions,
	): {
		read: Record<string, (args?: Record<string, unknown>) => Promise<unknown>>;
	};
}

/**
 * Reads a contract's read-only functions from a handler, with typed results.
 *
 * Pass `ctx`, the contract id and its ABI. Every call is pinned to the block
 * being processed. Set `options.cache` to `"contract-constant"` to fetch a
 * value once per contract instead of once per block.
 *
 * @example
 * ```ts
 * const token = readContractAt(ctx, contractId, SIP010_ABI, {
 *   cache: "contract-constant",
 * });
 * const decimals = await token.read.getDecimals(); // bigint
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

/**
 * A handler asked for something no node can answer: a function missing from
 * the ABI, or one that isn't read-only. Deterministic, so it fails only the
 * event. A read the processor couldn't complete (no node, node down, cache
 * error) throws {@link HandlerReadError} instead and aborts the block.
 */
export class ChainReadError extends Error {
	override name = "ChainReadError";
}

/**
 * The error for a processor with no node to read from. A hosted tenant has no
 * node of its own and can't set one, so it gets the real limit rather than an
 * env var to set.
 */
async function noNodeError(db: Kysely<Database>): Promise<HandlerReadError> {
	if (await hasNoLocalChain(db)) {
		return new HandlerReadError(
			"Contract reads (ctx.client) aren't available on hosted subgraphs yet; they arrive with the next release. The subgraph resumes from this block after it.",
		);
	}
	return new HandlerReadError(
		"ctx.client needs a Stacks node: set STACKS_NODE_RPC_URL on the subgraph processor.",
	);
}

/**
 * True when the node answered for the pinned block. The answer is a fact of
 * the chain, so the handler owns it: `err` responses and contract runtime
 * errors fail only the event, like any other handler error.
 */
function isChainAnswer(err: unknown): boolean {
	return (
		err instanceof ContractResponseError || err instanceof ReadContractError
	);
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
		const db = ctx.db ?? getSourceDb();
		const rpcUrl = ctx.rpcUrl ?? process.env.STACKS_NODE_RPC_URL;
		if (!rpcUrl) throw await noNodeError(db);

		const constant = options.cache === "contract-constant";
		if (!constant && !ctx.indexBlockHash) {
			throw new HandlerReadError(
				`Block ${ctx.blockHeight} has no index_block_hash, so a read cannot be pinned to it. Reading at the node's tip would make this handler non-deterministic (the same reindex would produce different rows). Re-ingest the block, or pass cache: "contract-constant" if the value genuinely cannot change.`,
			);
		}

		const fn = findFunction(abi, functionName);
		const clarityArgs = buildFunctionArgs(fn, args);
		const argsHash = hashArgs(clarityArgs);
		const pinnedTo = constant ? null : (ctx.indexBlockHash as string);

		// Everything from here to the cache write is the processor's I/O, not
		// the handler's logic: a failure aborts the block so it retries, rather
		// than committing the block without this event's rows.
		let resultHex: string;
		try {
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

			resultHex =
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
		} catch (err) {
			if (isChainAnswer(err)) throw err;
			throw new HandlerReadError(
				`Chain read ${contractId}::${fn.name} at block ${ctx.blockHeight} failed: ${getErrorMessage(err)}`,
				{ cause: err },
			);
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
