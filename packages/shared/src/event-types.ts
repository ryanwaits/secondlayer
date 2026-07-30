// The decoded event-type vocabulary — canonical home is now
// `@secondlayer/stacks/filters` (the LEAF of the dependency graph: shared
// depends on stacks, never the reverse, so no package can drift a private
// copy upward). Re-exported here so every existing `@secondlayer/shared`
// import keeps working unchanged.
import { DECODED_EVENT_TYPES } from "@secondlayer/stacks/filters";
import type { DecodedEventType } from "@secondlayer/stacks/filters";

export {
	DECODED_EVENT_TYPES,
	type DecodedEventType,
} from "@secondlayer/stacks/filters";

/** Alias kept for the Streams surface (identical to {@link DECODED_EVENT_TYPES}).
 *  Explicit type annotation required — isolatedDeclarations emits `unknown` for
 *  a bare const-to-const alias. */
export const STREAMS_EVENT_TYPES: typeof DECODED_EVENT_TYPES =
	DECODED_EVENT_TYPES;
export type StreamsEventType = DecodedEventType;
