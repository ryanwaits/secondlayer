import { describe, expect, test } from "bun:test";
import { EMPTY_RANGE_EVENT_INDEX_SENTINEL } from "../streams-cursor.ts";
import {
	type CanonicalBlock,
	type DecoderClockEvent,
	type DecoderClockInput,
	inputDigest,
	planDecoderReceipts,
} from "./decoder-clock.ts";
import { applyRunnerEvent, createRunnerState } from "./runner.ts";

const SENTINEL = EMPTY_RANGE_EVENT_INDEX_SENTINEL;

function hash(height: number): string {
	return `0x${height.toString(16).padStart(2, "0")}`;
}

function blocks(from: number, to: number): CanonicalBlock[] {
	const out: CanonicalBlock[] = [];
	for (let height = from; height <= to; height++) {
		out.push({ height, hash: hash(height) });
	}
	return out;
}

function ev(
	cursor: string,
	opts?: { matched?: boolean; hash?: string },
): DecoderClockEvent {
	const height = Number(cursor.split(":")[0]);
	return {
		cursor,
		block_hash: opts?.hash ?? hash(height),
		matched: opts?.matched ?? true,
	};
}

function input(
	overrides: Partial<DecoderClockInput> &
		Pick<DecoderClockInput, "to_cursor" | "blocks">,
): DecoderClockInput {
	return {
		start_height: 100,
		from_cursor: null,
		events: [],
		...overrides,
	};
}

describe("cursor/block seam corpus", () => {
	test("matched events in one closed block become one receipt", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "101:0",
				blocks: blocks(100, 100),
				events: [ev("100:0"), ev("100:3")],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.receipts).toHaveLength(1);
		expect(result.receipts[0]).toMatchObject({
			height: 100,
			hash: hash(100),
			input_count: 2,
			input_cursors: ["100:0", "100:3"],
			through_cursor: "100:3",
			no_match: false,
		});
		expect(result.receipts[0]?.input_digest).toBe(
			inputDigest(["100:0", "100:3"]),
		);
	});

	test("filtered firehose still receipts no-match blocks at the seam", () => {
		// Consume jumps 100:0 → 105:0. 101–104 never appear in the event list.
		const result = planDecoderReceipts(
			input({
				from_cursor: `${99}:${SENTINEL}`,
				to_cursor: "106:0",
				blocks: blocks(100, 105),
				events: [ev("100:0"), ev("105:0")],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(
			result.receipts.map((r) => [r.height, r.input_count, r.no_match]),
		).toEqual([
			[100, 1, false],
			[101, 0, true],
			[102, 0, true],
			[103, 0, true],
			[104, 0, true],
			[105, 1, false],
		]);
		expect(result.receipts[1]?.through_cursor).toBe(`101:${SENTINEL}`);
		expect(result.receipts[1]?.input_digest).toBe(inputDigest([]));
	});

	test("an open block (to_cursor still inside it) emits no receipt", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "100:4",
				blocks: blocks(100, 100),
				events: [ev("100:0"), ev("100:3")],
			}),
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.receipts).toEqual([]);
	});

	test("a sentinel to_cursor closes the block, including no-match", () => {
		const closed = planDecoderReceipts(
			input({
				to_cursor: `100:${SENTINEL}`,
				blocks: blocks(100, 100),
				events: [ev("100:0")],
			}),
		);
		expect(closed.ok).toBe(true);
		if (closed.ok) {
			expect(closed.receipts).toHaveLength(1);
			expect(closed.receipts[0]?.no_match).toBe(false);
		}

		const empty = planDecoderReceipts(
			input({
				to_cursor: `100:${SENTINEL}`,
				blocks: blocks(100, 100),
				events: [],
			}),
		);
		expect(empty.ok).toBe(true);
		if (empty.ok) {
			expect(empty.receipts[0]).toMatchObject({
				height: 100,
				input_count: 0,
				no_match: true,
				through_cursor: `100:${SENTINEL}`,
			});
		}
	});

	test("a mid-block from_cursor waits for the next full block", () => {
		const result = planDecoderReceipts(
			input({
				from_cursor: "100:2",
				to_cursor: "102:0",
				blocks: blocks(100, 101),
				events: [ev("100:5"), ev("101:0")],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.receipts.map((r) => r.height)).toEqual([101]);
		expect(result.receipts[0]?.input_count).toBe(1);
	});

	test("unmatched stream events still close the block; only matches count", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "101:0",
				blocks: blocks(100, 100),
				events: [
					ev("100:0", { matched: false }),
					ev("100:1"),
					ev("100:2", { matched: false }),
				],
			}),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.receipts[0]).toMatchObject({
			input_count: 1,
			input_cursors: ["100:1"],
			through_cursor: "100:2",
			no_match: false,
		});
	});

	test("hash mismatch at the seam is refused", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "101:0",
				blocks: blocks(100, 100),
				events: [ev("100:0", { hash: "0xdead" })],
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("does not match canonical");
	});

	test("out-of-order cursors are refused", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "101:0",
				blocks: blocks(100, 100),
				events: [ev("100:4"), ev("100:1")],
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("not after");
	});

	test("an event at or before from_cursor is refused", () => {
		const result = planDecoderReceipts(
			input({
				from_cursor: "100:2",
				to_cursor: "102:0",
				blocks: blocks(100, 101),
				events: [ev("100:2")],
			}),
		);
		expect(result.ok).toBe(false);
	});

	test("an event at or after to_cursor is refused", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "101:0",
				blocks: blocks(100, 100),
				events: [ev("101:0")],
			}),
		);
		expect(result.ok).toBe(false);
	});

	test("a hole in the canonical block list is refused", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "103:0",
				blocks: [
					{ height: 100, hash: hash(100) },
					{ height: 102, hash: hash(102) },
				],
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("not contiguous");
	});

	test("a closed height without a canonical row is refused", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "102:0",
				blocks: blocks(100, 100),
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(result.reason).toContain("missing canonical block 101");
	});

	test("an event whose height is not in the block list is refused", () => {
		const result = planDecoderReceipts(
			input({
				to_cursor: "101:5",
				blocks: blocks(100, 100),
				events: [ev("100:0"), ev("101:0")],
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("no canonical block");
	});

	test("to_cursor must be after from_cursor", () => {
		const result = planDecoderReceipts(
			input({
				from_cursor: "101:0",
				to_cursor: "100:0",
				blocks: blocks(100, 101),
			}),
		);
		expect(result.ok).toBe(false);
	});

	test("planned receipts ack in order on the runner", () => {
		const planned = planDecoderReceipts(
			input({
				to_cursor: "103:0",
				blocks: blocks(100, 102),
				events: [ev("100:0"), ev("102:1")],
			}),
		);
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		let state = createRunnerState({
			stage_id: "decode:ft_transfer",
			start_height: 100,
			target_height: 102,
			version: { code_hash: "c", config_hash: "k", handler_hash: null },
		});
		const started = applyRunnerEvent(state, { type: "start" });
		if (!started.ok) throw new Error(started.reason);
		state = started.state;
		for (const receipt of planned.receipts) {
			const acked = applyRunnerEvent(state, {
				type: "ack",
				height: receipt.height,
				hash: receipt.hash,
				input_count: receipt.input_count,
				input_digest: receipt.input_digest,
				effect_digest: "e",
			});
			expect(acked.ok).toBe(true);
			if (!acked.ok) return;
			state = acked.state;
		}
		expect(state.complete_through).toBe(102);
		const finished = applyRunnerEvent(state, { type: "finish" });
		expect(finished.ok).toBe(true);
	});
});
