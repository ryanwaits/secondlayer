import { describe, expect, test } from "bun:test";
import { ValidationError } from "../errors.ts";
import {
	type SinkDriver,
	type SinkRollbackContext,
	createSink,
} from "../sinks/core.ts";

/**
 * createSink policy checks that no store is needed to prove: a driver that
 * predates `clearCursor` must refuse a genesis rewind instead of committing
 * a checkpoint it cannot represent; onRollback runs before the delete and
 * a throw aborts the rewind.
 */

type Tx = { deleted: Array<[string, number]>; cursor?: string | null };

function makeDriver(withClear: boolean) {
	const state = {
		cursor: "11:0" as string | null,
		txs: [] as Tx[],
		order: [] as string[],
	};
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
			state.order.push("cursor");
			tx.cursor = cursor;
		},
		async deleteAtOrAbove(tx, table, height) {
			state.order.push("delete");
			tx.deleted.push([table, height]);
		},
		async hasColumn() {
			return true;
		},
		...(withClear
			? {
					async clearCursor(tx: Tx) {
						state.order.push("clear");
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

describe("createSink onRollback", () => {
	test("runs before the fact-table delete, then writes the cursor", async () => {
		const { driver, state } = makeDriver(false);
		const seen: SinkRollbackContext[] = [];
		const sink = createSink(driver, {
			...options,
			onRollback: async (_tx, ctx) => {
				state.order.push("hook");
				seen.push(ctx);
			},
		});
		await sink.rollback(11, "10:2147483647");
		expect(state.order).toEqual(["hook", "delete", "cursor"]);
		expect(seen).toEqual([
			{ forkPointHeight: 11, rewindCursor: "10:2147483647" },
		]);
		expect(state.txs[0]?.deleted).toEqual([["rows", 11]]);
		expect(state.cursor).toBe("10:2147483647");
	});

	test("a throw aborts the rewind — no delete, no cursor write", async () => {
		const { driver, state } = makeDriver(false);
		const sink = createSink(driver, {
			...options,
			onRollback: async () => {
				state.order.push("hook");
				throw new Error("fold failed");
			},
		});
		await expect(sink.rollback(11, "10:2147483647")).rejects.toThrow(
			"fold failed",
		);
		expect(state.order).toEqual(["hook"]);
		expect(state.txs).toEqual([]);
		expect(state.cursor).toBe("11:0");
	});

	test("re-application still calls the hook (idempotency is the hook's job)", async () => {
		const { driver, state } = makeDriver(false);
		const sink = createSink(driver, {
			...options,
			onRollback: async () => {
				state.order.push("hook");
			},
		});
		await sink.rollback(11, "10:2147483647");
		await sink.rollback(11, "10:2147483647");
		expect(state.order.filter((s) => s === "hook")).toHaveLength(2);
	});
});
