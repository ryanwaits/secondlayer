// The decoded event-type vocabulary — canonical home is now
// `@secondlayer/stacks/filters` (the LEAF of the dependency graph: shared
// depends on stacks, never the reverse, so no package can drift a private
// copy upward). Re-exported here so every existing `@secondlayer/shared`
// import keeps working unchanged.
import {
	DECODED_EVENT_TYPES,
	type VM_NODE_TO_STORED_TYPE,
} from "@secondlayer/stacks/filters";
import type { DecodedEventType } from "@secondlayer/stacks/filters";

export {
	DECODED_EVENT_TYPES,
	VM_EVENT_TYPES,
	VM_NODE_TO_STORED_TYPE,
	type DecodedEventType,
	type VmEventType,
	type VmNodeEventType,
} from "@secondlayer/stacks/filters";

type VmStoredToNode = {
	[K in keyof typeof VM_NODE_TO_STORED_TYPE as (typeof VM_NODE_TO_STORED_TYPE)[K]]: K;
};

/** Inverse of {@link VM_NODE_TO_STORED_TYPE}. Replay reconstruction emits the
 *  node-shaped `/new_block.vm_events` body, so ingest can re-parse it. */
export const VM_STORED_TO_NODE_TYPE: VmStoredToNode = {
	nested_contract_call: "contract_call_event",
	var_set: "var_set_event",
	map_set: "map_set_event",
	map_insert: "map_insert_event",
	map_delete: "map_delete_event",
};

/** Alias kept for the Streams surface (identical to {@link DECODED_EVENT_TYPES}).
 *  Explicit type annotation required — isolatedDeclarations emits `unknown` for
 *  a bare const-to-const alias. */
export const STREAMS_EVENT_TYPES: typeof DECODED_EVENT_TYPES =
	DECODED_EVENT_TYPES;
export type StreamsEventType = DecodedEventType;
