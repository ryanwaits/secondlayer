// Runes read surface tests (plan 058). Two halves:
//   - Response-builder tests below use stubbed readers — no DB, fast, cover
//     query parsing/validation/the not-configured soft-flag (TDD-first, same
//     shape as pox5-events.test.ts).
//   - The `describe.skipIf(!BITCOIN_TEST_DATABASE_URL)` block at the bottom
//     runs the real `sql`-backed readers against a scratch Bitcoin/Runes
//     database — the same convention as packages/bitcoin's
//     rewind.test.ts/follow.test.ts. That database is migrated with
//     packages/bitcoin's own migrator first (this file only truncates
//     between tests; it never creates/drops/migrates the database itself):
//
//   docker exec <postgres-container> psql -U postgres -c \
//     "CREATE DATABASE bitcoin_runes058_test"
//   cd packages/bitcoin && BITCOIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/bitcoin_runes058_test \
//     bun run src/db/migrate.ts
//   BITCOIN_TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5440/bitcoin_runes058_test \
//     bun test src/index/runes.test.ts
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { Database as BitcoinDatabase } from "@secondlayer/bitcoin/db";
import { spacedRuneFromString } from "@secondlayer/bitcoin/rune";
import { ValidationError } from "@secondlayer/shared/errors";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { BitcoinIndexTip } from "../bitcoin/db.ts";
import { readBtcReorgs } from "../bitcoin/db.ts";
import {
	type RuneActivityReader,
	type RuneBalancesReader,
	type RuneEntry,
	type RuneReader,
	type RunesReader,
	getRuneActivityResponse,
	getRuneBalancesResponse,
	getRuneResponse,
	getRunesResponse,
	readRune,
	readRuneActivity,
	readRuneBalances,
	readRunes,
} from "./runes.ts";

const TIP: BitcoinIndexTip = {
	block_height: 840_100,
	finalized_height: 840_094,
	lag_seconds: 30,
};

const DOG_ENTRY: RuneEntry = {
	id: "840000:3",
	number: "0",
	name: "DOGGOTOTHEMOON",
	spaced_name: "DOG•GO•TO•THE•MOON",
	symbol: "🐕",
	divisibility: 5,
	premine: "10000000000000000",
	supply: "10000000000000000",
	burned: "0",
	mints: "0",
	turbo: true,
	etching_txid: "aa".repeat(32),
	etched_height: 840_000,
	etched_tx_index: 3,
	terms: null,
};

function query(params: Record<string, string> = {}): URLSearchParams {
	return new URLSearchParams(params);
}

describe("getRunesResponse (stubbed reader)", () => {
	test("not configured returns an empty list with a note", async () => {
		const res = await getRunesResponse({
			query: query(),
			tip: TIP,
			configured: false,
		});
		expect(res.runes).toEqual([]);
		expect(res.reorgs).toEqual([]);
		expect(res.notes).toMatch(/BITCOIN_DATABASE_URL/);
	});

	test("passes search/sort through to the reader", async () => {
		let seen: unknown;
		const readRunesStub: RunesReader = async (params) => {
			seen = params;
			return { runes: [DOG_ENTRY], next_cursor: null };
		};
		const res = await getRunesResponse({
			query: query({ search: "dog", sort: "mints" }),
			tip: TIP,
			configured: true,
			readRunes: readRunesStub,
		});
		expect(seen).toMatchObject({ search: "DOG", sort: "mints" });
		expect(res.runes).toEqual([DOG_ENTRY]);
	});

	test("rejects an unknown sort", async () => {
		await expect(
			getRunesResponse({ query: query({ sort: "bogus" }), tip: TIP }),
		).rejects.toThrow(ValidationError);
	});
});

describe("getRuneResponse (stubbed reader)", () => {
	test("not configured is a 404-shaped miss with a note", async () => {
		const res = await getRuneResponse({
			runeRef: { id: "840000:3" },
			tip: TIP,
			configured: false,
		});
		expect(res).toEqual({
			found: false,
			notes: expect.stringMatching(/BITCOIN_DATABASE_URL/),
		});
	});

	test("no matching row is a plain miss (no note)", async () => {
		const readRuneStub: RuneReader = async () => null;
		const res = await getRuneResponse({
			runeRef: { id: "1:1" },
			tip: TIP,
			configured: true,
			readRune: readRuneStub,
		});
		expect(res).toEqual({ found: false });
	});

	test("found returns the entry alongside the tip", async () => {
		const readRuneStub: RuneReader = async () => DOG_ENTRY;
		const res = await getRuneResponse({
			runeRef: { id: "840000:3" },
			tip: TIP,
			configured: true,
			readRune: readRuneStub,
		});
		expect(res).toEqual({ found: true, rune: DOG_ENTRY, tip: TIP });
	});
});

describe("getRuneActivityResponse (stubbed reader)", () => {
	test("not configured returns an empty page with a note", async () => {
		const res = await getRuneActivityResponse({
			query: query(),
			tip: TIP,
			configured: false,
		});
		expect(res.events).toEqual([]);
		expect(res.reorgs).toEqual([]);
		expect(res.notes).toMatch(/BITCOIN_DATABASE_URL/);
	});

	test("maps wire kinds to db kinds and rejects an unknown one", async () => {
		let seen: unknown;
		const readActivityStub: RuneActivityReader = async (params) => {
			seen = params;
			return { events: [], next_cursor: null };
		};
		await getRuneActivityResponse({
			query: query({ kind: "rune_mint,rune_transfer" }),
			tip: TIP,
			configured: true,
			readRuneActivity: readActivityStub,
		});
		expect(seen).toMatchObject({ kinds: ["mint", "transfer"] });

		await expect(
			getRuneActivityResponse({
				query: query({ kind: "rune_mint,not_a_kind" }),
				tip: TIP,
				configured: true,
				readRuneActivity: readActivityStub,
			}),
		).rejects.toThrow(ValidationError);
	});

	// "unknown query param" rejection is the router's job (`validateQueryParams`
	// in routes/index.ts, run before any getXResponse is called) — covered in
	// routes.test.ts, not here.

	test("cursor and from_height are mutually exclusive", async () => {
		await expect(
			getRuneActivityResponse({
				query: query({ cursor: "840000:0", from_height: "1" }),
				tip: TIP,
				configured: true,
			}),
		).rejects.toThrow(ValidationError);
	});

	test("defaults the window to ~1 day of Bitcoin blocks, not Stacks'", async () => {
		let seen: { fromHeight: number; toHeight: number } | undefined;
		const readActivityStub: RuneActivityReader = async (params) => {
			seen = params;
			return { events: [], next_cursor: null };
		};
		await getRuneActivityResponse({
			query: query(),
			tip: TIP,
			configured: true,
			readRuneActivity: readActivityStub,
		});
		// 144 blocks/day at Bitcoin's ~10 minute cadence — see runes.ts.
		expect(seen?.fromHeight).toBe(TIP.block_height - 144);
		expect(seen?.toHeight).toBe(TIP.block_height);
	});
});

describe("getRuneBalancesResponse (stubbed reader)", () => {
	test("not configured returns an empty page with a note", async () => {
		const res = await getRuneBalancesResponse({
			query: query({ address: "bc1qexample" }),
			tip: TIP,
			configured: false,
		});
		expect(res.balances).toEqual([]);
		expect(res.notes).toMatch(/BITCOIN_DATABASE_URL/);
	});

	test("requires exactly one of address / outpoint", async () => {
		await expect(
			getRuneBalancesResponse({ query: query(), tip: TIP, configured: true }),
		).rejects.toThrow(ValidationError);

		await expect(
			getRuneBalancesResponse({
				query: query({
					address: "bc1qexample",
					outpoint: `${"aa".repeat(32)}:0`,
				}),
				tip: TIP,
				configured: true,
			}),
		).rejects.toThrow(ValidationError);
	});

	test("parses an outpoint filter through to the reader", async () => {
		let seen: unknown;
		const readBalancesStub: RuneBalancesReader = async (params) => {
			seen = params;
			return { balances: [], next_cursor: null };
		};
		await getRuneBalancesResponse({
			query: query({ outpoint: `${"bb".repeat(32)}:2` }),
			tip: TIP,
			configured: true,
			readRuneBalances: readBalancesStub,
		});
		expect(seen).toMatchObject({
			outpoint: { txid: "bb".repeat(32), vout: 2 },
			address: undefined,
		});
	});
});

// ── DB-backed reader tests ───────────────────────────────────────────────

const testUrl = process.env.BITCOIN_TEST_DATABASE_URL;

function openTestDb(url: string): Kysely<BitcoinDatabase> {
	const client = postgres(url, { max: 4 });
	return new Kysely<BitcoinDatabase>({
		dialect: new PostgresJSDialect({ postgres: client }),
	});
}

const DOG_SPACED = spacedRuneFromString("DOG.GO.TO.THE.MOON");
const CAT_SPACED = spacedRuneFromString("CATS.ARE.COOL");

describe.skipIf(!testUrl)("Runes readers (DB-backed)", () => {
	// biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!testUrl) guards this whole block
	const db = openTestDb(testUrl!);

	async function insertEntry(opts: {
		rune_id: string;
		block: number;
		tx: number;
		number: number;
		rune: bigint;
		spaced_rune: string;
		spacers: number;
		symbol: string;
		premine: string;
		terms_amount: string | null;
		mints: string;
		burned: string;
	}) {
		await db
			.insertInto("rune_entries")
			.values({
				rune_id: opts.rune_id,
				block: String(opts.block),
				tx: String(opts.tx),
				number: String(opts.number),
				rune: opts.rune.toString(),
				spaced_rune: opts.spaced_rune,
				spacers: opts.spacers,
				divisibility: 5,
				symbol: opts.symbol,
				symbol_codepoint: opts.symbol.codePointAt(0) ?? null,
				premine: opts.premine,
				terms_amount: opts.terms_amount,
				terms_cap: opts.terms_amount ? "1000000" : null,
				terms_height_start: null,
				terms_height_end: null,
				terms_offset_start: null,
				terms_offset_end: null,
				has_terms: opts.terms_amount !== null,
				turbo: true,
				etching_txid: "aa".repeat(32),
				timestamp: "1713571767",
				mints: opts.mints,
				burned: opts.burned,
				repaired_at: new Date(),
			})
			.execute();
	}

	async function insertEvent(opts: {
		height: number;
		tx_index: number;
		txid: string;
		kind: "etch" | "mint" | "transfer" | "burn";
		rune_id: string;
		amount: string;
		vout: number | null;
		event_index: number;
		address: string | null;
	}) {
		await db.insertInto("rune_events").values(opts).execute();
	}

	async function insertBalance(opts: {
		txid: string;
		vout: number;
		rune_id: string;
		amount: string;
		address: string | null;
	}) {
		await db.insertInto("rune_balances").values(opts).execute();
	}

	beforeEach(async () => {
		await db.deleteFrom("rune_events").execute();
		await db.deleteFrom("rune_balances").execute();
		await db.deleteFrom("rune_entries").execute();
		await db.deleteFrom("btc_reorgs").execute();

		await insertEntry({
			rune_id: "840000:3",
			block: 840_000,
			tx: 3,
			number: 0,
			rune: DOG_SPACED.rune.n,
			spaced_rune: "DOG•GO•TO•THE•MOON",
			spacers: DOG_SPACED.spacers,
			symbol: "🐕",
			premine: "10000000000000000",
			terms_amount: "100000000000",
			mints: "5",
			burned: "0",
		});
		await insertEntry({
			rune_id: "840010:7",
			block: 840_010,
			tx: 7,
			number: 1,
			rune: CAT_SPACED.rune.n,
			spaced_rune: "CATS•ARE•COOL",
			spacers: CAT_SPACED.spacers,
			symbol: "🐈",
			premine: "0",
			terms_amount: "50",
			mints: "20",
			burned: "3",
		});
	});

	afterAll(async () => {
		await db.destroy();
	});

	describe("readRunes", () => {
		test("defaults to etch order (sort=number)", async () => {
			const { runes, next_cursor } = await readRunes({
				sort: "number",
				limit: 10,
				db,
			});
			expect(runes.map((r) => r.id)).toEqual(["840000:3", "840010:7"]);
			// A resume-token cursor, not a "has more" flag (matches pox5-events.ts):
			// present whenever the page has a last row, `null` only once a page
			// comes back empty.
			expect(next_cursor).not.toBeNull();
			const empty = await readRunes({
				sort: "number",
				limit: 10,
				after: decodeNumberCursor(next_cursor as string),
				db,
			});
			expect(empty.runes).toEqual([]);
			expect(empty.next_cursor).toBeNull();
		});

		test("sort=mints orders busiest first", async () => {
			const { runes } = await readRunes({ sort: "mints", limit: 10, db });
			expect(runes.map((r) => r.id)).toEqual(["840010:7", "840000:3"]);
		});

		test("search ignores case and spacers", async () => {
			const { runes } = await readRunes({
				search: "DOGGO",
				sort: "number",
				limit: 10,
				db,
			});
			expect(runes.map((r) => r.id)).toEqual(["840000:3"]);
		});

		test("keyset pagination continues from next_cursor", async () => {
			const page1 = await readRunes({ sort: "number", limit: 1, db });
			expect(page1.runes.map((r) => r.id)).toEqual(["840000:3"]);
			expect(page1.next_cursor).not.toBeNull();

			// biome-ignore lint/style/noNonNullAssertion: asserted not-null above
			const after = decodeNumberCursor(page1.next_cursor!);
			const page2 = await readRunes({
				sort: "number",
				limit: 10,
				after,
				db,
			});
			expect(page2.runes.map((r) => r.id)).toEqual(["840010:7"]);
		});

		test("computes supply as premine + mints × terms.amount", async () => {
			const { runes } = await readRunes({ sort: "number", limit: 10, db });
			const cat = runes.find((r) => r.id === "840010:7");
			// premine 0 + mints 20 × terms_amount 50 = 1000
			expect(cat?.supply).toBe("1000");
			expect(cat?.terms?.amount).toBe("50");
		});
	});

	describe("readRune", () => {
		test("resolves by id", async () => {
			const rune = await readRune({ id: "840000:3" }, db);
			expect(rune?.name).toBe("DOGGOTOTHEMOON");
			expect(rune?.spaced_name).toBe("DOG•GO•TO•THE•MOON");
		});

		test("resolves by name (RuneRef.rune) to the same entry as by id", async () => {
			const byId = await readRune({ id: "840000:3" }, db);
			const byName = await readRune({ rune: DOG_SPACED.rune.n }, db);
			expect(byName).toEqual(byId);
		});

		test("returns null for an unknown rune", async () => {
			expect(await readRune({ id: "1:1" }, db)).toBeNull();
		});
	});

	describe("readRuneActivity", () => {
		beforeEach(async () => {
			await insertEvent({
				height: 840_001,
				tx_index: 0,
				txid: "e1".repeat(32),
				kind: "mint",
				rune_id: "840000:3",
				amount: "100000000000",
				vout: 0,
				event_index: 0,
				address: null,
			});
			await insertEvent({
				height: 840_002,
				tx_index: 1,
				txid: "e2".repeat(32),
				kind: "transfer",
				rune_id: "840000:3",
				amount: "50000000000",
				vout: 1,
				event_index: 0,
				address: "bc1qrecipient",
			});
			await insertEvent({
				height: 840_003,
				tx_index: 0,
				txid: "e3".repeat(32),
				kind: "burn",
				rune_id: "840010:7",
				amount: "10",
				vout: null,
				event_index: 0,
				address: null,
			});
		});

		test("returns events with amounts as decimal strings, oldest first", async () => {
			const { events } = await readRuneActivity({
				fromHeight: 840_000,
				toHeight: 840_010,
				limit: 10,
				db,
			});
			expect(events.map((e) => e.txid)).toEqual([
				"e1".repeat(32),
				"e2".repeat(32),
				"e3".repeat(32),
			]);
			expect(events[0]?.amount).toBe("100000000000");
			expect(typeof events[0]?.amount).toBe("string");
			expect(events[0]?.kind).toBe("rune_mint");
			expect(events[1]?.kind).toBe("rune_transfer");
			expect(events[0]?.rune.name).toBe("DOGGOTOTHEMOON");
		});

		test("filters by rune, address, kind, and txid", async () => {
			const byRune = await readRuneActivity({
				fromHeight: 840_000,
				toHeight: 840_010,
				limit: 10,
				rune: { id: "840010:7" },
				db,
			});
			expect(byRune.events.map((e) => e.txid)).toEqual(["e3".repeat(32)]);

			const byAddress = await readRuneActivity({
				fromHeight: 840_000,
				toHeight: 840_010,
				limit: 10,
				address: "bc1qrecipient",
				db,
			});
			expect(byAddress.events.map((e) => e.txid)).toEqual(["e2".repeat(32)]);

			const byKind = await readRuneActivity({
				fromHeight: 840_000,
				toHeight: 840_010,
				limit: 10,
				kinds: ["burn"],
				db,
			});
			expect(byKind.events.map((e) => e.txid)).toEqual(["e3".repeat(32)]);

			const byTxid = await readRuneActivity({
				fromHeight: 840_000,
				toHeight: 840_010,
				limit: 10,
				txid: "e1".repeat(32),
				db,
			});
			expect(byTxid.events.map((e) => e.txid)).toEqual(["e1".repeat(32)]);
		});

		test("a rune filter that matches no entry short-circuits to an empty page", async () => {
			const nonexistentRuneN = DOG_SPACED.rune.n + 999_999_999n;
			const { events, next_cursor } = await readRuneActivity({
				fromHeight: 840_000,
				toHeight: 840_010,
				limit: 10,
				rune: { rune: nonexistentRuneN },
				db,
			});
			expect(events).toEqual([]);
			expect(next_cursor).toBeNull();
		});

		test("keyset pagination via <height>:<event_index> cursor", async () => {
			const page1 = await readRuneActivity({
				fromHeight: 840_000,
				toHeight: 840_010,
				limit: 1,
				db,
			});
			expect(page1.events.map((e) => e.txid)).toEqual(["e1".repeat(32)]);
			expect(page1.next_cursor).toBe("840001:0");

			const [afterHeight, afterEventIndex] = (page1.next_cursor as string)
				.split(":")
				.map(Number);
			const page2 = await readRuneActivity({
				fromHeight: 840_000,
				toHeight: 840_010,
				limit: 10,
				after: {
					block_height: afterHeight as number,
					event_index: afterEventIndex as number,
				},
				db,
			});
			expect(page2.events.map((e) => e.txid)).toEqual([
				"e2".repeat(32),
				"e3".repeat(32),
			]);
		});

		test("getRuneActivityResponse surfaces a reorg overlapping the page, and hides one that doesn't", async () => {
			await db
				.insertInto("btc_reorgs")
				.values({
					fork_point_height: 840_001,
					old_hash: "old".padEnd(64, "0"),
					new_hash: "new".padEnd(64, "0"),
					orphaned_from: 840_001,
					orphaned_to: 840_002,
					new_tip_height: 840_003,
				})
				.execute();
			await db
				.insertInto("btc_reorgs")
				.values({
					fork_point_height: 900_000,
					old_hash: "far-old".padEnd(64, "0"),
					new_hash: "far-new".padEnd(64, "0"),
					orphaned_from: 900_000,
					orphaned_to: 900_001,
					new_tip_height: 900_002,
				})
				.execute();

			const res = await getRuneActivityResponse({
				query: query({ from_height: "840000", to_height: "840010" }),
				tip: TIP,
				configured: true,
				readRuneActivity: (params) => readRuneActivity({ ...params, db }),
				readReorgs: (fromHeight, toHeight) =>
					readBtcReorgs(fromHeight, toHeight, db),
			});
			expect(res.reorgs).toHaveLength(1);
			expect(res.reorgs[0]?.fork_point_height).toBe(840_001);
		});
	});

	describe("readRuneBalances", () => {
		beforeEach(async () => {
			await insertBalance({
				txid: "b1".repeat(32),
				vout: 0,
				rune_id: "840000:3",
				amount: "1000",
				address: "bc1qholder1",
			});
			await insertBalance({
				txid: "b1".repeat(32),
				vout: 0,
				rune_id: "840010:7",
				amount: "2000",
				address: "bc1qholder1",
			});
			await insertBalance({
				txid: "b2".repeat(32),
				vout: 1,
				rune_id: "840000:3",
				amount: "500",
				address: "bc1qholder2",
			});
		});

		test("filters by address, embedding the rune identity", async () => {
			const { balances } = await readRuneBalances({
				address: "bc1qholder1",
				limit: 10,
				db,
			});
			expect(balances).toHaveLength(2);
			expect(balances.every((b) => b.address === "bc1qholder1")).toBe(true);
			const dog = balances.find((b) => b.rune.id === "840000:3");
			expect(dog?.amount).toBe("1000");
			expect(dog?.rune.name).toBe("DOGGOTOTHEMOON");
		});

		test("an outpoint can carry more than one rune", async () => {
			const { balances } = await readRuneBalances({
				outpoint: { txid: "b1".repeat(32), vout: 0 },
				limit: 10,
				db,
			});
			expect(balances.map((b) => b.rune.id).sort()).toEqual([
				"840000:3",
				"840010:7",
			]);
		});

		test("rune filter narrows an address to one rune", async () => {
			const { balances } = await readRuneBalances({
				address: "bc1qholder1",
				rune: { id: "840010:7" },
				limit: 10,
				db,
			});
			expect(balances.map((b) => b.rune.id)).toEqual(["840010:7"]);
		});
	});
});

function decodeNumberCursor(raw: string): { sort: "number"; number: bigint } {
	const decoded = Buffer.from(raw, "base64url").toString("utf8");
	const [, n] = decoded.split(":");
	return { sort: "number", number: BigInt(n as string) };
}
