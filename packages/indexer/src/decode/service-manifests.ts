import type { ServiceManifest } from "@secondlayer/shared/archive/derived-stage-report";

/**
 * Decoder service manifests — one entry per built-in protocol producer.
 *
 * These are the first worked examples of the derived-stage acceptance report
 * (see `@secondlayer/shared/archive/derived-stage-report`). Each manifest
 * answers the operator's rebuild question honestly: given only the canonical
 * archive, could you resurrect this decoder's output tables? If not, what
 * else do you need — a stacks-node RPC, a contract source, the Streams API,
 * something else — and why?
 *
 * Actual stateful re-run + digest comparison is Phase 4 (P4.10 effect
 * manifests, P4.13 stateful deep verify). This file is intentionally a
 * declarations-only layer: it tells the truth about dependencies so the
 * Phase 4 verifier knows what to pin.
 */

const CANONICAL_ALL = ["blocks", "transactions", "events"] as const;

/**
 * Shared external inputs that most decoders take. Extracted so the
 * declarations stay easy to skim and so adding a new decoder is a
 * paste-and-adjust job, not a from-scratch decision on shared boilerplate.
 */
const STREAMS_API_INPUT = {
	name: "streams-api",
	reason:
		"decoders read canonical events through the Streams client rather than raw parquet — the runtime path is the same as production live-decode",
	source: "bundled-secondlayer-runtime",
	rebuildable_from_archive: true,
} as const;

const CONTRACT_SOURCE_REGISTRY_INPUT = {
	name: "contract-source-registry",
	reason:
		"decoded events reference function signatures and event topics defined in the target contract's Clarity source; those definitions live outside `transactions.raw_tx`",
	source: "bundled-secondlayer-runtime",
	rebuildable_from_archive: false,
} as const;

export const SBTC_SERVICE_MANIFEST: ServiceManifest = {
	name: "decode:sbtc",
	kind: "protocol-producer",
	description:
		"sBTC registry decoder — completed-deposit, withdrawal lifecycle, key-rotation, and protocol-contract updates emitted by SBTC_REGISTRY_CONTRACTS",
	canonical_inputs: [...CANONICAL_ALL],
	external_inputs: [
		STREAMS_API_INPUT,
		{
			...CONTRACT_SOURCE_REGISTRY_INPUT,
			reason:
				"sbtc-registry, sbtc-token, and downstream contracts publish print-events whose topic names and argument shapes are defined in their Clarity source; the decoder resolves them via `@secondlayer/stacks/sbtc`",
		},
	],
	outputs: [
		{
			target: "sbtc_events",
			verification: "row-count + semantic-digest per (tx_id, event_index)",
		},
		{
			target: "sbtc_token_events",
			verification: "row-count + semantic-digest per (tx_id, event_index)",
		},
		{ target: "sbtc_supply_snapshots", verification: "row-count per block" },
		{
			target: "sbtc_settlements",
			verification:
				"row-count per L1 settlement plus witness-based proof against the raw block bytes",
		},
	],
	r2_alone_can_rebuild: false,
	requires_operator_state: false,
	source_path: "packages/indexer/src/decode/decoders/sbtc.ts",
};

export const POX4_SERVICE_MANIFEST: ServiceManifest = {
	name: "decode:pox4",
	kind: "protocol-producer",
	description:
		"PoX-4 contract-call decoder — stack/delegate/aggregation-commit lifecycle plus per-cycle and per-signer daily aggregates",
	canonical_inputs: [...CANONICAL_ALL],
	external_inputs: [
		STREAMS_API_INPUT,
		{
			...CONTRACT_SOURCE_REGISTRY_INPUT,
			reason:
				"pox-4 function names, argument shapes, and reward-cycle constants (first burnchain height, cycle length) come from `@secondlayer/stacks/pox`; the decoder cannot infer them from raw_tx alone",
		},
		{
			name: "stacks-node-rpc",
			reason:
				"reward-cycle rollups need the burn-block → cycle mapping and current stacker set; both are read from `/v2/pox` and `/v3/stacker_set/{cycle}` via IndexHttpClient",
			source: "own-node or bundled-stacks",
			rebuildable_from_archive: false,
		},
	],
	outputs: [
		{
			target: "pox4_calls",
			verification: "row-count + semantic-digest per (tx_id)",
		},
		{
			target: "pox4_cycles_daily",
			verification:
				"row-count per (cycle, day) — an aggregate over pox4_calls, checkable by re-derivation",
		},
		{
			target: "pox4_signers_daily",
			verification:
				"row-count per (cycle, signer, day) — same re-derivation invariant",
		},
	],
	r2_alone_can_rebuild: false,
	requires_operator_state: false,
	source_path: "packages/indexer/src/decode/decoders/pox-4.ts",
};

export const BNS_SERVICE_MANIFEST: ServiceManifest = {
	name: "decode:bns",
	kind: "protocol-producer",
	description:
		"BNSx decoder — name and namespace lifecycle events plus marketplace listings, from bnsx-registry and marketplace contracts",
	canonical_inputs: [...CANONICAL_ALL],
	external_inputs: [
		STREAMS_API_INPUT,
		{
			...CONTRACT_SOURCE_REGISTRY_INPUT,
			reason:
				"BNSx topic names, marketplace actions, and namespace-status enums are Clarity constants defined in bnsx-registry and its satellite contracts; the decoder resolves them via typed enums in `@secondlayer/shared/db`",
		},
	],
	outputs: [
		{
			target: "bns_name_events",
			verification: "row-count + semantic-digest per (tx_id, event_index)",
		},
		{
			target: "bns_namespace_events",
			verification: "row-count + semantic-digest per (tx_id, event_index)",
		},
		{
			target: "bns_marketplace_events",
			verification: "row-count + semantic-digest per (tx_id, event_index)",
		},
		{
			target: "bns_names",
			verification:
				"materialized state — re-derivable by replaying bns_name_events in order",
		},
		{
			target: "bns_namespaces",
			verification: "materialized state — same replay invariant",
		},
	],
	r2_alone_can_rebuild: false,
	requires_operator_state: false,
	source_path: "packages/indexer/src/decode/decoders/bns.ts",
};

/**
 * The registry every derived-stage report reads. Adding a new decoder is a
 * push here; the report aggregator picks it up automatically.
 */
export const DECODER_SERVICE_MANIFESTS: readonly ServiceManifest[] = [
	SBTC_SERVICE_MANIFEST,
	POX4_SERVICE_MANIFEST,
	BNS_SERVICE_MANIFEST,
];
