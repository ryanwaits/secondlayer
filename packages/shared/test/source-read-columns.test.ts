import { describe, expect, test } from "bun:test";
import {
	SOURCE_READ_COLUMNS,
	SOURCE_READ_PKS,
	SOURCE_READ_TYPES,
} from "../src/db/source-read-columns.ts";
import snapshot from "./__snapshots__/source-read-columns.json";

// SOURCE_READ_COLUMNS is the read contract between the indexer (write schema
// owner) and the API (raw reader). Any change to the columns the API depends on
// must be a deliberate, reviewed edit — this snapshot makes drift explicit. If
// this fails, regenerate the snapshot only after confirming the change is real:
//   bun -e 'import {SOURCE_READ_COLUMNS} from "./src/db/source-read-columns.ts";
//     await Bun.write("test/__snapshots__/source-read-columns.json",
//       JSON.stringify(SOURCE_READ_COLUMNS, null, "\t") + "\n")'
describe("SOURCE_READ_COLUMNS drift guard", () => {
	const snap = snapshot as Record<string, readonly string[]>;
	const live = SOURCE_READ_COLUMNS as Record<string, readonly string[]>;

	test("table set matches the snapshot", () => {
		expect(Object.keys(live).sort()).toEqual(Object.keys(snap).sort());
	});

	for (const table of Object.keys(snap)) {
		test(`${table} columns match the snapshot`, () => {
			expect(live[table]).toEqual(snap[table]);
		});
	}
});

// SOURCE_READ_TYPES carries the portable type for every read column (drives
// `sl index codegen`). It must cover exactly SOURCE_READ_COLUMNS — a column added
// to the read contract without a type here (or vice versa) makes codegen emit a
// wrong/partial schema. The `satisfies` clause guarantees table-key parity at
// compile time; this asserts per-column parity at runtime.
describe("SOURCE_READ_TYPES ↔ SOURCE_READ_COLUMNS", () => {
	const cols = SOURCE_READ_COLUMNS as Record<string, readonly string[]>;
	const types = SOURCE_READ_TYPES as Record<string, Record<string, unknown>>;

	test("same table set", () => {
		expect(Object.keys(types).sort()).toEqual(Object.keys(cols).sort());
	});

	for (const table of Object.keys(cols)) {
		test(`${table} has a type for every read column`, () => {
			expect(Object.keys(types[table]).sort()).toEqual([...cols[table]].sort());
		});
	}
});

// SOURCE_READ_PKS gives Prisma codegen a model identity. Every PK column must be a
// real read column, else the emitted `@id`/`@@id` references a field the schema
// doesn't have. `null` (no read-set key) is allowed — Prisma omits that table.
describe("SOURCE_READ_PKS ↔ SOURCE_READ_COLUMNS", () => {
	const cols = SOURCE_READ_COLUMNS as Record<string, readonly string[]>;
	const pks = SOURCE_READ_PKS as Record<string, readonly string[] | null>;

	test("same table set", () => {
		expect(Object.keys(pks).sort()).toEqual(Object.keys(cols).sort());
	});

	for (const table of Object.keys(cols)) {
		test(`${table} PK columns are read columns`, () => {
			const pk = pks[table];
			if (pk === null) return;
			for (const col of pk) expect(cols[table]).toContain(col);
		});
	}
});
