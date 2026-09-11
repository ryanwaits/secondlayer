/**
 * `@secondlayer/subgraphs/testing` — run a handler without deploying.
 *
 * There was no way to execute a handler outside production: seventeen `sl
 * subgraphs` subcommands and none ran one, `dev` deployed DDL and printed
 * handler keys, `--dry-run` validated schema only. The cost was measurable —
 * three of four production subgraphs shipped broken, including one that held
 * 0 rows chain-wide for a whole release because of a 3-line field-mapping bug
 * that a single fixture event would have caught.
 *
 * The context here is the REAL {@link SubgraphContext} with its row store
 * swapped for memory. Read-your-writes, upsert merging, increment deltas,
 * where-matching, and control-key handling all come from the one
 * implementation — a second copy of that logic already drifted once (see
 * `runtime/sandbox/overlay-parity.test.ts`), and this surface will not be the
 * third.
 */

export {
	buildEvent,
	buildEventPayload,
	createTestContext,
} from "./harness.ts";
export type {
	BlockMeta,
	TestSubgraphContext,
	TxMeta,
} from "./harness.ts";
export {
	probeHandlers,
	runSubgraphTest,
	toContractCallPayload,
	toHandlerPayload,
} from "./run.ts";
export type {
	EventTrace,
	IndexContractCallRow,
	IndexEventRow,
	IndexTestRow,
	ProbeHandlersDef,
	ProbeHandlersResult,
	RunSubgraphTestInput,
	SubgraphTestResult,
	SubgraphTestSource,
} from "./run.ts";
