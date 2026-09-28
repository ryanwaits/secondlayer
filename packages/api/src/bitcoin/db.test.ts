import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { Database as BitcoinDatabase } from "@secondlayer/bitcoin/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import {
	_resetBitcoinDbForTests,
	_resetBitcoinTipCacheForTests,
	getBitcoinTip,
	isBitcoinConfigured,
	parseRuneRef,
	readBtcReorgs,
} from "./db.ts";

describe("parseRuneRef", () => {
	test("parses an id", () => {
		expect(parseRuneRef("840000:3")).toEqual({ id: "840000:3" });
	});

	test("normalizes a leading-zero id to the canonical key", () => {
		expect(parseRuneRef("0840000:03")).toEqual({ id: "840000:3" });
	});

	test("parses a spaced (bullet) name", () => {
		const ref = parseRuneRef("DOG•GO•TO•THE•MOON");
		expect(ref).toHaveProperty("rune");
		expect((ref as { rune: bigint }).rune).toBe(
			(parseRuneRef("dog.go.to.the.moon") as { rune: bigint }).rune,
		);
	});

	test("dotted, lowercase, and unspaced names all resolve to the same rune", () => {
		const dotted = parseRuneRef("dog.go.to.the.moon") as { rune: bigint };
		const spaced = parseRuneRef("dog go to the moon") as { rune: bigint };
		const bare = parseRuneRef("doggotothemoon") as { rune: bigint };
		expect(dotted.rune).toBe(spaced.rune);
		expect(dotted.rune).toBe(bare.rune);
	});

	test("garbage input throws ValidationError", () => {
		expect(() => parseRuneRef("!!!not-a-rune###")).toThrow(ValidationError);
	});

	test("a malformed id-shaped string is treated as a name and still throws", () => {
		expect(() => parseRuneRef("840000:3:5")).toThrow(ValidationError);
	});
});

describe("isBitcoinConfigured / getBitcoinTip (unconfigured)", () => {
	const prevUrl = process.env.BITCOIN_DATABASE_URL;

	beforeEach(() => {
		delete process.env.BITCOIN_DATABASE_URL;
		_resetBitcoinDbForTests();
		_resetBitcoinTipCacheForTests();
	});

	afterEach(() => {
		if (prevUrl === undefined) delete process.env.BITCOIN_DATABASE_URL;
		else process.env.BITCOIN_DATABASE_URL = prevUrl;
		_resetBitcoinDbForTests();
		_resetBitcoinTipCacheForTests();
	});

	test("reports unconfigured when BITCOIN_DATABASE_URL is unset", () => {
		expect(isBitcoinConfigured()).toBe(false);
	});

	test("getBitcoinTip returns the zero tip with no DB", async () => {
		const tip = await getBitcoinTip(undefined);
		expect(tip).toEqual({
			block_height: 0,
			finalized_height: 0,
			lag_seconds: 0,
		});
	});

	test("readBtcReorgs returns empty with no DB", async () => {
		const reorgs = await readBtcReorgs(0, 1000, undefined);
		expect(reorgs).toEqual([]);
	});
});

// Reproduces plan 062's oss scenario: `BITCOIN_DATABASE_URL` is set and the
// database is reachable, but `packages/bitcoin`'s migrations never ran (the
// `bitcoin` compose profile — the service that runs `migrate` — isn't
// enabled). `isBitcoinConfigured()` alone can't see this (env-var-only
// check); `getBitcoinTip`/`readBtcReorgs` must degrade the same as
// unconfigured instead of throwing. Deliberately never migrated — see
// packages/api/src/index/runes.test.ts's header for the sibling convention
// of a *migrated* scratch DB; this one must stay empty.
//
//   docker exec <postgres-container> psql -U postgres -c \
//     "CREATE DATABASE bitcoin_db062_missing_table_test"
//   BITCOIN_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/bitcoin_db062_missing_table_test \
//     bun test src/bitcoin/db.test.ts
const missingTableTestUrl = process.env.BITCOIN_TEST_DATABASE_URL;

describe.skipIf(!missingTableTestUrl)(
	"getBitcoinTip / readBtcReorgs (database exists, tables missing)",
	() => {
		// biome-ignore lint/style/noNonNullAssertion: describe.skipIf guards this whole block
		const client = postgres(missingTableTestUrl!, { max: 1 });
		const db = new Kysely<BitcoinDatabase>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});

		afterEach(() => {
			_resetBitcoinTipCacheForTests();
		});

		afterAll(async () => {
			await db.destroy();
		});

		test("getBitcoinTip returns the zero tip instead of throwing", async () => {
			const tip = await getBitcoinTip(db);
			expect(tip).toEqual({
				block_height: 0,
				finalized_height: 0,
				lag_seconds: 0,
			});
		});

		test("readBtcReorgs returns empty instead of throwing", async () => {
			const reorgs = await readBtcReorgs(0, 1000, db);
			expect(reorgs).toEqual([]);
		});
	},
);

// Round 1 gap: an *existing* oss install pulling this update gets
// `BITCOIN_DATABASE_URL` pointed at a `bitcoin` database that was never
// created (the postgres init script only runs on a brand-new volume — see
// docker/oss/postgres-init/01-create-bitcoin-db.sh). That's a stronger
// failure than "table missing": Postgres refuses the connection itself
// (`3D000`, `invalid_catalog_name`) before any query can even run. Points at
// a database name derived from `missingTableTestUrl` that this file never
// creates — same server, same gating env var, no extra setup needed.
describe.skipIf(!missingTableTestUrl)(
	"getBitcoinTip / readBtcReorgs (database itself doesn't exist)",
	() => {
		// `describe.skipIf` still evaluates this callback body to register its
		// tests even when the condition is true — the fallback keeps `new URL`
		// from throwing in that case (`postgres()` below tolerates `undefined`
		// the same way; this file's DB URL fields are otherwise unused once
		// skipped, since the `test()` bodies themselves never run).
		const absentDbUrl = new URL(missingTableTestUrl ?? "postgres://x/x");
		absentDbUrl.pathname = "/bitcoin_db062_absent_test";
		const client = postgres(absentDbUrl.toString(), { max: 1 });
		const db = new Kysely<BitcoinDatabase>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});

		afterEach(() => {
			_resetBitcoinTipCacheForTests();
		});

		afterAll(async () => {
			await db.destroy();
		});

		test("getBitcoinTip returns the zero tip instead of throwing", async () => {
			const tip = await getBitcoinTip(db);
			expect(tip).toEqual({
				block_height: 0,
				finalized_height: 0,
				lag_seconds: 0,
			});
		});

		test("readBtcReorgs returns empty instead of throwing", async () => {
			const reorgs = await readBtcReorgs(0, 1000, db);
			expect(reorgs).toEqual([]);
		});
	},
);
