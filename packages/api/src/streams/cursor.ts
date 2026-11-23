import type { StreamsCursor } from "@secondlayer/shared";

export type StreamsCursorInput = StreamsCursor;
export {
	decodeFeedCursor,
	decodeStreamsCursor,
	decodeTaggedStreamsCursor,
	encodeFeedCursor,
	encodeStreamsCursor,
} from "@secondlayer/shared";
