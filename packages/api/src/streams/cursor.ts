// The Streams cursor codec is canonical in @secondlayer/shared so every product
// shares one implementation. Re-exported here for existing import sites.
import type { StreamsCursor } from "@secondlayer/shared";

export type StreamsCursorInput = StreamsCursor;
export { decodeStreamsCursor, encodeStreamsCursor } from "@secondlayer/shared";
