import { describe, expect, test } from "bun:test";
import { SOURCE_READ_COLUMNS } from "../src/db/source-read-columns.ts";
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
