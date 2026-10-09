/**
 * `@secondlayer/subgraphs/verify`: recompute a state-level subgraph from
 * header-backed inputs and check its served rows. Powers
 * `secondlayer verify subgraph --replay`.
 */
export {
	type PinCheck,
	REPLAY_WINDOW,
	type ReplayDeps,
	type ReplayFailure,
	type ReplayOptions,
	type ReplayResult,
	type ReplayStep,
	checkPin,
	replayBlocks,
	replayContracts,
	replaySubgraph,
} from "./replay.ts";
export { loadDeterministicDefinition } from "../runtime/realm.ts";
export {
	type RowComparison,
	type TableComparison,
	compareRows,
} from "./compare.ts";
