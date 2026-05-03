export type StreamsCursorInput = {
	block_height: number;
	event_index: number;
};

export function encodeStreamsCursor(event: StreamsCursorInput): string {
	return `${event.block_height}:${event.event_index}`;
}

export function decodeStreamsCursor(cursor: string): StreamsCursorInput {
	const match = /^(\d+):(\d+)$/.exec(cursor);
	if (!match) {
		throw new Error("Invalid Streams cursor");
	}

	return {
		block_height: Number(match[1]),
		event_index: Number(match[2]),
	};
}
