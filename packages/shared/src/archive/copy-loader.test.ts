import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { getRawClient, getSourceDb } from "../db/index.ts";
import {
	copyStatement,
	toCsvLine,
	writeRowsToCopyStream,
} from "./copy-loader.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 993_000;

describe("state_writes CSV encoding", () => {
	test("a block-level write carries tx_index as the unquoted NULL marker", () => {
		expect(
			toCsvLine("state_writes", {
				block_height: 7n,
				ordinal: 0,
				tx_index: null,
				key: "vm-metadata::9::contract",
				value_hex: "0x00",
			}),
		).toBe('"7","0",\\N,"vm-metadata::9::contract","0x00"');
	});

	test("COPY names the state_writes columns in Parquet order", () => {
		expect(copyStatement("state_writes")).toBe(
			"COPY state_writes (block_height, ordinal, tx_index, key, value_hex) FROM STDIN WITH (FORMAT csv, NULL '\\N')",
		);
	});
});

describe.skipIf(!HAS_DB)("state_writes COPY round-trip", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function clean() {
		if (!db) return;
		// state_writes follow their block out (ON DELETE CASCADE).
		await sql`DELETE FROM blocks WHERE height = ${H}`.execute(db);
	}
	afterAll(clean);

	test("state_writes rows round-trip through COPY with a null tx_index", async () => {
		if (!db) throw new Error("missing db");
		await clean();
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: `0xh${H}`,
				parent_hash: `0xh${H - 1}`,
				burn_block_height: H,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();

		const rows = [
			{
				block_height: BigInt(H),
				ordinal: 0,
				tx_index: null,
				key: "vm-metadata::9::contract",
				value_hex: "0x00",
			},
			{
				block_height: BigInt(H),
				ordinal: 1,
				tx_index: 0,
				key: 'vm::SP1.c::1::"quoted"',
				value_hex: "0x0100",
			},
		];
		async function* source() {
			yield* rows;
		}
		const writable = await getRawClient("source")
			.unsafe(copyStatement("state_writes"))
			.writable();
		const written = await writeRowsToCopyStream({
			writable,
			dataset: "state_writes",
			rows: source(),
		});
		expect(written).toBe(2);

		const { rows: stored } = await sql<{
			ordinal: number;
			tx_index: number | null;
			key: string;
			value_hex: string;
		}>`SELECT ordinal, tx_index, key, value_hex FROM state_writes
			WHERE block_height = ${H} ORDER BY ordinal`.execute(db);
		expect(stored).toEqual([
			{
				ordinal: 0,
				tx_index: null,
				key: "vm-metadata::9::contract",
				value_hex: "0x00",
			},
			{
				ordinal: 1,
				tx_index: 0,
				key: 'vm::SP1.c::1::"quoted"',
				value_hex: "0x0100",
			},
		]);
	});
});
