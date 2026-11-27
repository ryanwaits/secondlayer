import { describe, expect, test } from "bun:test";
import { countRawStatusWrites } from "./status-writes.ts";

describe("countRawStatusWrites", () => {
	test("detects Kysely .set() with status key", () => {
		expect(
			countRawStatusWrites(`db.updateTable("t").set({ status: "failed" })`),
		).toBe(1);
		expect(
			countRawStatusWrites(
				`db.updateTable("t").set({ a: 1, status: "failed" })`,
			),
		).toBe(1);
	});

	test("detects Kysely .doUpdateSet() with status key", () => {
		expect(
			countRawStatusWrites(
				`oc.column("id").doUpdateSet({ status: "scanning" })`,
			),
		).toBe(1);
		expect(
			countRawStatusWrites(
				`oc.column("id").doUpdateSet({ a: 1, nested: { b: 2 }, status: "scanning" })`,
			),
		).toBe(1);
	});

	test("detects SQL SET status case-insensitively", () => {
		expect(countRawStatusWrites(`sql\`UPDATE t SET status = 'done'\``)).toBe(1);
		expect(countRawStatusWrites(`sql\`update t set status = 'done'\``)).toBe(1);
		expect(countRawStatusWrites(`sql\`UPDATE t Set status = 'done'\``)).toBe(1);
	});

	test("ignores casTransition and normal property reads", () => {
		expect(
			countRawStatusWrites(
				`casTransition(db, { table: "t", id: "1", from: ["dead"], to: "pending" })`,
			),
		).toBe(0);
		expect(
			countRawStatusWrites(
				"const s = row.status; return { status: row.status };",
			),
		).toBe(0);
		expect(
			countRawStatusWrites(
				`db.updateTable("t").set({ STATUS: "not_a_column" })`,
			),
		).toBe(0);
	});
});
