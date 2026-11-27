import type {
	CanonicalInput,
	ServiceManifest,
} from "@secondlayer/shared/archive/derived-stage-report";

/** Every archive dataset a decoder reads — not `ARCHIVE_DATASETS`: a dataset
 *  joins this list only when a decoder actually consumes it. No decoder reads
 *  `state_writes`, so it is left out. */
const CANONICAL_ALL = [
	"blocks",
	"transactions",
	"events",
] as const satisfies readonly CanonicalInput[];

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
			target: "sbtc_settlements",
			verification:
				"row-count per L1 settlement plus witness-based proof against the raw block bytes",
		},
	],
	r2_alone_can_rebuild: false,
	requires_operator_state: false,
	source_path: "packages/indexer/src/decode/decoders/sbtc.ts",
};

export const BNS_SERVICE_MANIFEST: ServiceManifest = {
	name: "decode:bns",
	kind: "protocol-producer",
	description:
		"BNSx decoder — name and namespace lifecycle events plus marketplace listings, from bnsx-registry and marketplace contracts",
	canonical_inputs: [...CANONICAL_ALL],
	external_inputs: [
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

export const DECODER_SERVICE_MANIFESTS: readonly ServiceManifest[] = [
	SBTC_SERVICE_MANIFEST,
	BNS_SERVICE_MANIFEST,
];
