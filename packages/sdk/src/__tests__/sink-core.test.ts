import { describe, expect, test } from "bun:test";
import { ValidationError } from "../errors.ts";
import { type SinkDriver, createSink } from "../sinks/core.ts";

/**
 * createSink policy checks that no store is needed to prove: a driver that
 * predates `clearCursor` must refuse a genesis rewind instead of committing
 * a checkpoint it cannot represent.
 */

type Tx = { deleted: Array<[string, number]>; cursor?: string | null };

function makeDriver(withClear: boolean) {
	const state = { cursor: "11:0" as string | null, txs: [] as Tx[] };
	const driver: SinkDriver<Tx> = {
		async transact(fn) {
			const tx: Tx = { deleted: [] };
			const out = await fn(tx);
			state.txs.push(tx);
			if (tx.cursor !== undefined) state.cursor = tx.cursor;
			return out;
		},
		async ensureCheckpointStore() {},
		async readCursor() {
			return state.cursor;
		},
		async writeCursor(tx, cursor) {
			tx.cursor = cursor;
		},
		async deleteAtOrAbove(tx, table, height) {
			tx.deleted.push([table, height]);
		},
		async hasColumn() {
			return true;
		},
		...(withClear
			? {
					async clearCursor(tx: Tx) {
						tx.cursor = null;
					},
				}
			: {}),
	};
	return { driver, state };
}

const options = { label: "testSink", id: "t", tables: ["rows"], height: "h" };

describe("createSink genesis rewind", () => {
	test("driver without clearCursor rejects a null rewind with ValidationError and commits nothing", async () => {
		const { driver, state } = makeDriver(false);
		const sink = createSink(driver, options);
		await expect(sink.rollback(0, null)).rejects.toBeInstanceOf(
			ValidationError,
		);
		await expect(sink.rollback(0, null)).rejects.toThrow(/clearCursor/);
		expect(state.txs).toEqual([]);
		expect(state.cursor).toBe("11:0");
	});

	test("driver with clearCursor deletes from the fork and drops the checkpoint", async () => {
		const { driver, state } = makeDriver(true);
		const sink = createSink(driver, options);
		await sink.rollback(0, null);
		expect(state.txs).toHaveLength(1);
		expect(state.txs[0]?.deleted).toEqual([["rows", 0]]);
		expect(state.cursor).toBeNull();
	});
});
