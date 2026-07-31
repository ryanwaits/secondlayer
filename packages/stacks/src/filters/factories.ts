import type { AbiContract } from "../clarity/abi/contract.ts";
import type { ChainEventFilterType } from "./event-types.ts";
import type { SubgraphMemberType, SubgraphSourceSpec } from "./types.ts";
import type {
	ChainEventFilter,
	ChainEventFilterSpec,
	ChainTriggerShape,
	ContractCallsParamsShape,
	IndexEventsParamsShape,
	PrintFieldType,
	SpecFor,
	StreamsParamsShape,
} from "./types.ts";
import {
	assertAssetIdentifier,
	assertContractId,
	assertPrincipalish,
	hasWildcard,
} from "./validate.ts";

// ── Field metadata driving validation and projections ────────────────────

const PRINCIPAL_FIELDS = new Set([
	"sender",
	"recipient",
	"caller",
	"deployer",
	"lockedAddress",
]);
const AMOUNT_FIELDS = new Set(["minAmount", "maxAmount"]);
/** Fields with no filtering semantics — safe to drop in a projection. */
const DECORATIVE_FIELDS = new Set(["abi", "prints"]);

function specEntries(spec: ChainEventFilterSpec): Array<[string, unknown]> {
	return Object.entries(spec).filter(
		([key, value]) => key !== "type" && value !== undefined,
	);
}

function validateSpec(spec: ChainEventFilterSpec): void {
	for (const [key, value] of specEntries(spec)) {
		if (PRINCIPAL_FIELDS.has(key)) {
			assertPrincipalish(key, value as string);
		} else if (key === "assetIdentifier") {
			assertAssetIdentifier(key, value as string);
		} else if (key === "contractId") {
			// A contract SET validates member-wise — one bad id in a router+pools
			// list must fail as loudly as a bad single id.
			for (const id of Array.isArray(value) ? value : [value]) {
				assertContractId(key, id as string);
			}
		}
	}
}

/** Throw for a field the target surface cannot express — dropping it would
 *  silently widen the match, which is the exact bug this module exists to
 *  kill. Names the surface that CAN express it. */
function unsupported(surface: string, field: string, hint: string): never {
	throw new Error(
		`${field} cannot be expressed on ${surface} — ${hint}. Drop the field from the filter or use the surface that supports it.`,
	);
}

function assertNoWildcards(surface: string, spec: ChainEventFilterSpec): void {
	for (const [key, value] of specEntries(spec)) {
		// Arrays too: a wildcard inside a contractId set would otherwise reach
		// the wire as a literal `IN ('SP….pool-*')` — the silent zero-row match
		// this module exists to kill.
		const candidates = Array.isArray(value) ? value : [value];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && hasWildcard(candidate)) {
				unsupported(
					surface,
					`${key} wildcard "${candidate}"`,
					"wildcard patterns are Subscriptions/Subgraphs-only",
				);
			}
		}
	}
}

/** The Index API treats `trait` and `contractId` as mutually exclusive (a
 *  trait already resolves to a contract set). Throw here, naming the fix,
 *  instead of letting the pair reach the server as a 400. Subgraphs AND them
 *  — that surface accepts both. */
function assertNotTraitAndContract(
	surface: string,
	spec: ChainEventFilterSpec,
): void {
	const trait = "trait" in spec ? spec.trait : undefined;
	const contract = "contractId" in spec ? spec.contractId : undefined;
	if (trait !== undefined && contract !== undefined) {
		unsupported(
			surface,
			"trait with contractId",
			"the Index treats them as mutually exclusive — drop one, or use a subgraph source, which ANDs the pair",
		);
	}
}

// ── Projections ──────────────────────────────────────────────────────────

function toChainTrigger(spec: ChainEventFilterSpec): ChainTriggerShape {
	const out: Record<string, string | number> = {};
	for (const [key, value] of specEntries(spec)) {
		if (DECORATIVE_FIELDS.has(key)) continue;
		if (key === "factory") {
			unsupported(
				"Subscriptions",
				"factory",
				"dynamic factory discovery is a Subgraphs-only concept — a trigger targets addresses known when it is created",
			);
		}
		if (Array.isArray(value)) {
			// One trigger, one contract: silently taking the first would watch
			// a fraction of what the filter says. Create one subscription per
			// contract instead.
			unsupported(
				"Subscriptions",
				`${key} set`,
				"a chain trigger targets ONE contract — create one subscription per contract, or use Index/Subgraphs which accept the set",
			);
		}
		// The one sanctioned bigint→string boundary.
		out[key] =
			typeof value === "bigint" ? value.toString() : (value as string | number);
	}
	return { type: spec.type, ...out };
}

function toIndexParams(
	spec: ChainEventFilterSpec,
	extra: Record<string, unknown> = {},
): IndexEventsParamsShape {
	assertNoWildcards("Index events", spec);
	assertNotTraitAndContract("Index events", spec);
	const out: Record<string, unknown> = {
		eventType: spec.type === "print_event" ? "print" : spec.type,
	};
	for (const [key, value] of specEntries(spec)) {
		if (DECORATIVE_FIELDS.has(key)) continue;
		if (key === "factory") {
			unsupported(
				"Index events",
				"factory",
				"dynamic factory discovery is a Subgraphs-only concept",
			);
		}
		if (AMOUNT_FIELDS.has(key)) {
			unsupported(
				"Index events",
				key,
				"amount predicates are Subscriptions/Subgraphs-only; filter client-side on the decoded rows",
			);
		}
		if (key === "topic") {
			unsupported(
				"Index events",
				"topic",
				"per-topic reads are Subgraphs/Subscriptions-only (or read the contract's print feed and switch on topic)",
			);
		}
		if (key === "lockedAddress") {
			// Index normalizes stx_lock's locked_address INTO the `sender` column
			// (the row's sender IS the locked address) — a rename, not a gap.
			out.sender = value;
			continue;
		}
		if (key === "caller") {
			unsupported(
				"Index events",
				"caller",
				"contract-call fields live on index.contractCalls",
			);
		}
		out[key] = value;
	}
	return { ...out, ...extra } as IndexEventsParamsShape;
}

function toStreamsParams(
	spec: ChainEventFilterSpec,
	extra: Record<string, unknown> = {},
): StreamsParamsShape {
	assertNoWildcards("Streams", spec);
	const out: Record<string, unknown> = {
		types: [spec.type === "print_event" ? "print" : spec.type],
	};
	for (const [key, value] of specEntries(spec)) {
		if (DECORATIVE_FIELDS.has(key)) continue;
		if (key === "factory") {
			unsupported(
				"Streams",
				"factory",
				"dynamic factory discovery is a Subgraphs-only concept",
			);
		}
		if (AMOUNT_FIELDS.has(key)) {
			unsupported(
				"Streams",
				key,
				"amount predicates are Subscriptions/Subgraphs-only",
			);
		}
		if (key === "trait") {
			unsupported(
				"Streams",
				"trait",
				"Streams has no trait resolution — Index and Subgraphs do",
			);
		}
		if (key === "topic") {
			unsupported(
				"Streams",
				"topic",
				"per-topic filtering is Subgraphs/Subscriptions-only",
			);
		}
		if (key === "lockedAddress") {
			unsupported(
				"Streams",
				"lockedAddress",
				"stx_lock address filtering is Subscriptions/Subgraphs-only",
			);
		}
		out[key] = value;
	}
	return { ...out, ...extra } as StreamsParamsShape;
}

function toContractCallsParams(
	spec: ChainEventFilterSpec,
	extra: Record<string, unknown> = {},
): ContractCallsParamsShape {
	assertNoWildcards("Index contract-calls", spec);
	assertNotTraitAndContract("Index contract-calls", spec);
	const out: Record<string, unknown> = {};
	for (const [key, value] of specEntries(spec)) {
		if (DECORATIVE_FIELDS.has(key)) continue;
		if (key === "factory") {
			unsupported(
				"Index contract-calls",
				"factory",
				"dynamic factory discovery is a Subgraphs-only concept",
			);
		}
		if (key === "caller") {
			// The endpoint filters by tx sender, which IS the caller — a rename,
			// not a gap.
			out.sender = value;
			continue;
		}
		out[key] = value;
	}
	return { ...out, ...extra } as ContractCallsParamsShape;
}

function toSubgraphSource(spec: ChainEventFilterSpec): ChainEventFilterSpec {
	// The spec IS the subgraph source shape (camelCase, bigint amounts,
	// literal prints/abi preserved). Strip the projection methods by copying
	// data fields only.
	return Object.fromEntries([
		["type", spec.type],
		...specEntries(spec),
	]) as unknown as ChainEventFilterSpec;
}

// ── Factory ──────────────────────────────────────────────────────────────

const DECODED_MEMBERS = new Set<ChainEventFilterType>([
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"print_event",
]);

/** Build a canonical filter: validated spec + the projections its member
 *  supports (methods are attached per member at runtime, matching the
 *  type-level gating exactly). `const F` preserves field literals — a
 *  `prints`/`abi` declaration keeps its exact type through
 *  `toSubgraphSource()`, which is what feeds `defineSubgraph` narrowing. */
export function makeChainEventFilter<
	T extends ChainEventFilterType,
	const F extends Omit<SpecFor<T>, "type">,
>(type: T, fields: F): ChainEventFilter<T, { type: T } & F> {
	const spec = { type, ...fields } as unknown as SpecFor<T>;
	validateSpec(spec);

	const filter = { ...spec } as unknown as Record<string, unknown>;
	filter.toChainTrigger = () => toChainTrigger(spec);
	if (DECODED_MEMBERS.has(type)) {
		filter.toIndexParams = (extra?: Record<string, unknown>) =>
			toIndexParams(spec, extra);
		filter.toStreamsParams = (extra?: Record<string, unknown>) =>
			toStreamsParams(spec, extra);
	}
	if (type === "contract_call") {
		filter.toContractCallsParams = (extra?: Record<string, unknown>) =>
			toContractCallsParams(spec, extra);
	}
	if (!type.startsWith("sbtc_")) {
		filter.toSubgraphSource = () => toSubgraphSource(spec);
	}
	return filter as unknown as ChainEventFilter<T, { type: T } & F>;
}

/**
 * Rehydrate a canonical filter from a subgraph-source-shaped object (the
 * inverse of `toSubgraphSource`). Powers migration and the round-trip
 * property gate: `toSubgraphSource(fromSubgraphSource(f))` must deep-equal
 * `f` for every production subgraph source.
 */
export function fromSubgraphSource(
	source: SubgraphSourceSpec,
): ChainEventFilter<SubgraphMemberType> {
	const { type, ...fields } = source;
	return makeChainEventFilter(
		type,
		fields as Omit<SpecFor<typeof type>, "type">,
	) as unknown as ChainEventFilter<SubgraphMemberType>;
}

type Fields<T extends ChainEventFilterType> = Omit<SpecFor<T>, "type">;

/** The `on.*` namespace, annotated explicitly — bunup's dts emitter needs an
 *  annotation on exported values (an inferred object of generic factories
 *  collapses to `{}` in the emitted declarations). */
export interface OnNamespace {
	stxTransfer(
		fields?: Fields<"stx_transfer">,
	): ChainEventFilter<"stx_transfer">;
	stxMint(fields?: Fields<"stx_mint">): ChainEventFilter<"stx_mint">;
	stxBurn(fields?: Fields<"stx_burn">): ChainEventFilter<"stx_burn">;
	stxLock(fields?: Fields<"stx_lock">): ChainEventFilter<"stx_lock">;
	ftTransfer(fields?: Fields<"ft_transfer">): ChainEventFilter<"ft_transfer">;
	ftMint(fields?: Fields<"ft_mint">): ChainEventFilter<"ft_mint">;
	ftBurn(fields?: Fields<"ft_burn">): ChainEventFilter<"ft_burn">;
	nftTransfer(
		fields?: Fields<"nft_transfer">,
	): ChainEventFilter<"nft_transfer">;
	nftMint(fields?: Fields<"nft_mint">): ChainEventFilter<"nft_mint">;
	nftBurn(fields?: Fields<"nft_burn">): ChainEventFilter<"nft_burn">;
	/** `abi` literals are preserved (`const A`) so `toSubgraphSource()` keeps
	 *  typing `event.input` inside `defineSubgraph`. */
	contractCall<const A extends AbiContract | undefined = undefined>(
		fields?: Omit<SpecFor<"contract_call">, "type" | "abi"> & { abi?: A },
	): ChainEventFilter<
		"contract_call",
		{ type: "contract_call" } & Omit<
			SpecFor<"contract_call">,
			"type" | "abi"
		> & {
				abi?: A;
			}
	>;
	contractDeploy(
		fields?: Fields<"contract_deploy">,
	): ChainEventFilter<"contract_deploy">;
	/** Canonical member is `print_event` (as Subgraphs and Subscriptions spell
	 *  it); `toIndexParams`/`toStreamsParams` project to `print`. `prints`
	 *  literals are preserved (`const P`) for per-topic `event.data` narrowing. */
	print<
		const P extends
			| Record<string, Record<string, PrintFieldType>>
			| undefined = undefined,
	>(
		fields?: Omit<SpecFor<"print_event">, "type" | "prints"> & { prints?: P },
	): ChainEventFilter<
		"print_event",
		{ type: "print_event" } & Omit<
			SpecFor<"print_event">,
			"type" | "prints"
		> & {
				prints?: P;
			}
	>;
	sbtcDeposit(
		fields?: Fields<"sbtc_deposit">,
	): ChainEventFilter<"sbtc_deposit">;
	sbtcWithdrawalCreate(
		fields?: Fields<"sbtc_withdrawal_create">,
	): ChainEventFilter<"sbtc_withdrawal_create">;
	sbtcWithdrawalAccept(
		fields?: Fields<"sbtc_withdrawal_accept">,
	): ChainEventFilter<"sbtc_withdrawal_accept">;
	sbtcWithdrawalReject(
		fields?: Fields<"sbtc_withdrawal_reject">,
	): ChainEventFilter<"sbtc_withdrawal_reject">;
	sbtcWithdrawalSweptConfirmed(
		fields?: Fields<"sbtc_withdrawal_swept_confirmed">,
	): ChainEventFilter<"sbtc_withdrawal_swept_confirmed">;
}

/**
 * `on.*` — one filter vocabulary for every surface.
 *
 * ```ts
 * import { on } from "@secondlayer/stacks/filters";
 *
 * const usdc = on.ftTransfer({ assetIdentifier: USDC, minAmount: 1_000_000n });
 *
 * sl.index.events.list(usdc.toIndexParams({ limit: 100 }));   // pull
 * sl.streams.events.consume({ ...usdc.toStreamsParams(), onBatch });
 * sl.subscriptions.create({ name, url, triggers: [usdc.toChainTrigger()] });
 * defineSubgraph({ sources: { usdc: usdc.toSubgraphSource() }, schema, handlers });
 * ```
 *
 * A surface a member can't reach is a missing method (compile error), and a
 * field a surface can't express throws at projection time — never a silent
 * zero-row or over-wide match.
 */
export const on: OnNamespace = {
	stxTransfer: (fields: Fields<"stx_transfer"> = {}) =>
		makeChainEventFilter("stx_transfer", fields),
	stxMint: (fields: Fields<"stx_mint"> = {}) =>
		makeChainEventFilter("stx_mint", fields),
	stxBurn: (fields: Fields<"stx_burn"> = {}) =>
		makeChainEventFilter("stx_burn", fields),
	stxLock: (fields: Fields<"stx_lock"> = {}) =>
		makeChainEventFilter("stx_lock", fields),
	ftTransfer: (fields: Fields<"ft_transfer"> = {}) =>
		makeChainEventFilter("ft_transfer", fields),
	ftMint: (fields: Fields<"ft_mint"> = {}) =>
		makeChainEventFilter("ft_mint", fields),
	ftBurn: (fields: Fields<"ft_burn"> = {}) =>
		makeChainEventFilter("ft_burn", fields),
	nftTransfer: (fields: Fields<"nft_transfer"> = {}) =>
		makeChainEventFilter("nft_transfer", fields),
	nftMint: (fields: Fields<"nft_mint"> = {}) =>
		makeChainEventFilter("nft_mint", fields),
	nftBurn: (fields: Fields<"nft_burn"> = {}) =>
		makeChainEventFilter("nft_burn", fields),
	contractCall: <const A extends AbiContract | undefined = undefined>(
		fields: Omit<SpecFor<"contract_call">, "type" | "abi"> & { abi?: A } = {},
	) => makeChainEventFilter("contract_call", fields),
	contractDeploy: (fields: Fields<"contract_deploy"> = {}) =>
		makeChainEventFilter("contract_deploy", fields),
	/** Canonical member is `print_event` (as Subgraphs and Subscriptions spell
	 *  it); `toIndexParams`/`toStreamsParams` project to `print`. */
	print: <
		const P extends
			| Record<string, Record<string, PrintFieldType>>
			| undefined = undefined,
	>(
		fields: Omit<SpecFor<"print_event">, "type" | "prints"> & {
			prints?: P;
		} = {},
	) => makeChainEventFilter("print_event", fields),
	sbtcDeposit: (fields: Fields<"sbtc_deposit"> = {}) =>
		makeChainEventFilter("sbtc_deposit", fields),
	sbtcWithdrawalCreate: (fields: Fields<"sbtc_withdrawal_create"> = {}) =>
		makeChainEventFilter("sbtc_withdrawal_create", fields),
	sbtcWithdrawalAccept: (fields: Fields<"sbtc_withdrawal_accept"> = {}) =>
		makeChainEventFilter("sbtc_withdrawal_accept", fields),
	sbtcWithdrawalReject: (fields: Fields<"sbtc_withdrawal_reject"> = {}) =>
		makeChainEventFilter("sbtc_withdrawal_reject", fields),
	sbtcWithdrawalSweptConfirmed: (
		fields: Fields<"sbtc_withdrawal_swept_confirmed"> = {},
	) => makeChainEventFilter("sbtc_withdrawal_swept_confirmed", fields),
};
