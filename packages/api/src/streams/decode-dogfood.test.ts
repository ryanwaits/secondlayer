import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	CLASSIC_TYPES,
	runClassicDecodeCycle,
} from "@secondlayer/indexer/decode/classic-decoders";
import { readCanonicalStreamsEvents } from "@secondlayer/indexer/streams-events";
import { createStreamsClient } from "@secondlayer/sdk";
import { getDb, sql } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { INDEX_READ_SCOPE, type IndexTokenStore } from "../index/auth.ts";
import { readFtTransfers } from "../index/ft-transfers.ts";
import { readNftTransfers } from "../index/nft-transfers.ts";
import { errorHandler } from "../middleware/error.ts";
import { createIndexRouter } from "../routes/index.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import { STREAMS_READ_SCOPE, type StreamsTokenStore } from "./auth.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const INTERNAL_STREAMS_KEY = "sk-sl_streams_decode_internal_test";
const INTERNAL_STREAMS_TOKENS: StreamsTokenStore = new Map([
	[
		INTERNAL_STREAMS_KEY,
		{
			tenant_id: "tenant_streams_decode_internal",
			tier: "internal",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
]);
const INDEX_KEY = "sk-sl_index_internal_test";
const INDEX_TOKENS: IndexTokenStore = new Map([
	[
		INDEX_KEY,
		{
			tenant_id: "tenant_index_internal",
			tier: "internal",
			scopes: [INDEX_READ_SCOPE],
		},
	],
]);

describe.skipIf(!HAS_DB)("classic decoders vs. Streams HTTP parity", () => {
	const db = HAS_DB ? getDb() : null;

	// The fixture lives at block height 1 and the in-process tip is height 1, so
	// the default 2-block reorg margin would clamp the served tip to 0 and hide
	// every event. Pin the margin to 0 so the decoder sees the fixture.
	const originalReorgMargin = process.env.STREAMS_TIP_REORG_MARGIN_BLOCKS;
	beforeAll(() => {
		process.env.STREAMS_TIP_REORG_MARGIN_BLOCKS = "0";
	});
	afterAll(() => {
		if (originalReorgMargin === undefined) {
			Reflect.deleteProperty(process.env, "STREAMS_TIP_REORG_MARGIN_BLOCKS");
		} else {
			if (originalReorgMargin === undefined)
				delete process.env.STREAMS_TIP_REORG_MARGIN_BLOCKS;
			else process.env.STREAMS_TIP_REORG_MARGIN_BLOCKS = originalReorgMargin;
		}
	});

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
		await sql`DELETE FROM decoder_checkpoints`.execute(db);
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);

		await db
			.insertInto("blocks")
			.values({
				height: 1,
				hash: "0x01",
				parent_hash: "0x00",
				burn_block_height: 101,
				timestamp: 1000,
				canonical: true,
			})
			.execute();
		await db
			.insertInto("transactions")
			.values([
				{
					tx_id: "tx-ft-1",
					block_height: 1,
					tx_index: 0,
					type: "token_transfer",
					sender: "SP1",
					status: "success",
					contract_id: null,
					raw_tx: "0x01",
				},
				{
					tx_id: "tx-print",
					block_height: 1,
					tx_index: 1,
					type: "contract_call",
					sender: "SP2",
					status: "success",
					contract_id: "SP2.print",
					raw_tx: "0x02",
				},
				{
					tx_id: "tx-ft-2",
					block_height: 1,
					tx_index: 2,
					type: "token_transfer",
					sender: "SP3",
					status: "success",
					contract_id: null,
					raw_tx: "0x03",
				},
				{
					tx_id: "tx-nft-1",
					block_height: 1,
					tx_index: 3,
					type: "contract_call",
					sender: "SP5",
					status: "success",
					contract_id: "SP5.collection",
					raw_tx: "0x04",
				},
				{
					tx_id: "tx-nft-bad",
					block_height: 1,
					tx_index: 4,
					type: "contract_call",
					sender: "SP7",
					status: "success",
					contract_id: "SP7.collection",
					raw_tx: "0x05",
				},
			])
			.execute();
		await db
			.insertInto("events")
			.values([
				{
					tx_id: "tx-ft-1",
					block_height: 1,
					event_index: 0,
					type: "ft_transfer_event",
					data: {
						asset_identifier: "SP1.token::sbtc",
						sender: "SP1",
						recipient: "SP2",
						amount: "10",
					},
				},
				{
					tx_id: "tx-print",
					block_height: 1,
					event_index: 0,
					type: "smart_contract_event",
					data: {
						contract_identifier: "SP2.print",
						topic: "print",
						value: { repr: "u1" },
					},
				},
				{
					tx_id: "tx-ft-2",
					block_height: 1,
					event_index: 0,
					type: "ft_transfer_event",
					data: {
						asset_identifier: "SP3.token::alex",
						sender: "SP3",
						recipient: "SP4",
						amount: "20",
					},
				},
				{
					tx_id: "tx-nft-1",
					block_height: 1,
					event_index: 0,
					type: "nft_transfer_event",
					data: {
						asset_identifier: "SP5.collection::token",
						sender: "SP5",
						recipient: "SP6",
						value: "0x0100000000000000000000000000000001",
					},
				},
				{
					tx_id: "tx-nft-bad",
					block_height: 1,
					event_index: 0,
					type: "nft_transfer_event",
					data: {
						asset_identifier: "SP7.collection::token",
						sender: "SP7",
						recipient: "SP8",
					},
				},
			])
			.execute();
	});

	function inProcessClient(apiKey = INTERNAL_STREAMS_KEY) {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/streams",
			createStreamsRouter({
				tokens: INTERNAL_STREAMS_TOKENS,
				getTip: () => ({
					block_height: 1,
					block_hash: "0x01",
					burn_block_height: 101,
					finalized_height: 0,
					lag_seconds: 0,
				}),
				readReorgs: async () => [],
			}),
		);

		return createStreamsClient({
			baseUrl: "http://secondlayer.test",
			apiKey,
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				return app.fetch(request);
			},
		});
	}

	test("rejects a decoder key the instance does not know once bound past loopback", async () => {
		if (!db) throw new Error("missing db");

		// On a loopback bind an unrecognized key is ignored, not fatal (the read
		// is anonymous anyway). Binding past loopback is what makes credentials
		// mandatory, so that is where a bad decoder key must fail.
		const prevHost = process.env.LISTEN_HOST;
		process.env.LISTEN_HOST = "0.0.0.0";
		try {
			await expect(
				inProcessClient("sk-sl_streams_bad_internal_test").events.list({
					fromHeight: 0,
					toHeight: 1,
					limit: 10,
				}),
			).rejects.toThrow(/key/i);
		} finally {
			if (prevHost === undefined)
				Reflect.deleteProperty(process.env, "LISTEN_HOST");
			else process.env.LISTEN_HOST = prevHost;
		}
	});

	// D1 (plan-066, decided 2026-09-26): classic decoders read
	// `readCanonicalStreamsEvents` in-process instead of over HTTP. The
	// dogfooding value HTTP consumption used to provide — catching a Streams
	// bug before an external consumer does — now lives here: the HTTP route
	// and the in-process reader must return byte-identical events and cursors
	// for the same range, at the internal tier (reorg margin 0) every
	// in-fleet decoder authenticates at.
	test("HTTP Streams and the in-process reader return identical classic events for the same range", async () => {
		if (!db) throw new Error("missing db");

		// `toHeight` is omitted from the HTTP call so the server derives it
		// itself, the same way a real request does: internal tier (reorg
		// margin 0, `getClampedStreamsTipHeight`) clamps it to `getTip()`'s
		// block_height (1 here). The in-process side uses that SAME raw tip
		// height directly — no margin — exactly what `runClassicDecodeCycle`
		// does against `getCurrentCanonicalTip`. If the internal-tier margin
		// ever stopped being 0, this is what would catch it.
		const httpResult = await inProcessClient().events.list({
			fromHeight: 0,
			types: CLASSIC_TYPES,
			limit: 100,
		});
		const inProcessResult = await readCanonicalStreamsEvents({
			db,
			fromHeight: 0,
			toHeight: 1,
			types: CLASSIC_TYPES,
			limit: 100,
		});

		expect(httpResult.next_cursor).toBe(inProcessResult.next_cursor);
		expect(httpResult.events.map((event) => event.cursor)).toEqual(
			inProcessResult.events.map((event) => event.cursor),
		);
		// Round-trip through JSON so the comparison is on the wire shape (what a
		// real HTTP client sees) rather than TS's discriminated-union typing,
		// which doesn't distribute cleanly through a rest-spread over a union.
		const httpEventsWithoutFinalized = JSON.parse(
			JSON.stringify(httpResult.events),
		).map((event: Record<string, unknown>) => {
			const { finalized: _finalized, ...rest } = event;
			return rest;
		});
		expect(httpEventsWithoutFinalized).toEqual(
			JSON.parse(JSON.stringify(inProcessResult.events)),
		);
	});

	test("the in-process classic loop decodes every classic type off the fixture, not just ft/nft transfer", async () => {
		if (!db) throw new Error("missing db");

		const result = await runClassicDecodeCycle({ db, limit: 10 });

		const rows = await db
			.selectFrom("decoded_events")
			.selectAll()
			.orderBy("cursor")
			.execute();

		// 2 ft_transfer + 1 print + 1 nft_transfer. The old per-type HTTP
		// consumers filtered server-side to their own type; the in-process loop
		// reads all 11 classic types off one scan, so the fixture's print event
		// (invisible to the old ft/nft-only assertions) is decoded too.
		expect(result.decoded).toBe(4);
		expect(rows.map((row) => row.cursor)).toEqual(["1:0", "1:1", "1:2", "1:3"]);
		expect(rows.map((row) => row.source_cursor)).toEqual([
			"1:0",
			"1:1",
			"1:2",
			"1:3",
		]);
		expect(rows[0]).toMatchObject({
			contract_id: "SP1.token",
			sender: "SP1",
			recipient: "SP2",
			amount: "10",
			asset_identifier: "SP1.token::sbtc",
		});
		expect(rows[1]).toMatchObject({ event_type: "print" });
		expect(rows[3]).toMatchObject({
			event_type: "nft_transfer",
			contract_id: "SP5.collection",
			sender: "SP5",
			recipient: "SP6",
			asset_identifier: "SP5.collection::token",
			value: "0x0100000000000000000000000000000001",
		});

		// The whole block's classic events fit in one page (limit 10 > 5 events),
		// which proves the scan already reached the tip empty-handed — the cycle
		// commits the end-of-block sentinel straight off this one page instead
		// of needing a follow-up empty poll to confirm block 1 is done.
		const checkpoint = await db
			.selectFrom("decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", "decode.nft_transfer.v1")
			.executeTakeFirstOrThrow();
		expect(checkpoint.last_cursor).toBe("1:2147483647");
	});

	test("bounded decoder rows are returned by /v1/index/ft-transfers with pagination", async () => {
		if (!db) throw new Error("missing db");

		await runClassicDecodeCycle({ db, limit: 10 });

		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				tokens: INDEX_TOKENS,
				getTip: () => ({
					block_height: 1,
					finalized_height: 0,
					lag_seconds: 0,
				}),
				readFtTransfers: (params) => readFtTransfers({ ...params, db }),
				readNftTransfers: (params) => readNftTransfers({ ...params, db }),
				readReorgs: async () => [],
			}),
		);

		const first = await app.request(
			"/v1/index/ft-transfers?from_height=0&limit=1",
			{
				headers: { Authorization: `Bearer ${INDEX_KEY}` },
			},
		);
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as {
			events: Array<{ cursor: string }>;
			next_cursor: string | null;
			reorgs: unknown[];
		};
		expect(firstBody.events.map((event) => event.cursor)).toEqual(["1:0"]);
		expect(firstBody.next_cursor).toBe("1:0");
		expect(firstBody.reorgs).toEqual([]);

		const second = await app.request(
			`/v1/index/ft-transfers?cursor=${firstBody.next_cursor}&limit=10`,
			{
				headers: { Authorization: `Bearer ${INDEX_KEY}` },
			},
		);
		expect(second.status).toBe(200);
		const secondBody = (await second.json()) as {
			events: Array<{ cursor: string }>;
		};
		expect(secondBody.events.map((event) => event.cursor)).toEqual(["1:2"]);
	});

	test("bounded decoder rows are returned by /v1/index/nft-transfers with pagination", async () => {
		if (!db) throw new Error("missing db");

		await runClassicDecodeCycle({ db, limit: 10 });

		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/index",
			createIndexRouter({
				tokens: INDEX_TOKENS,
				getTip: () => ({
					block_height: 1,
					finalized_height: 0,
					lag_seconds: 0,
				}),
				readFtTransfers: (params) => readFtTransfers({ ...params, db }),
				readNftTransfers: (params) => readNftTransfers({ ...params, db }),
				readReorgs: async () => [],
			}),
		);

		const res = await app.request(
			"/v1/index/nft-transfers?from_height=0&limit=1",
			{
				headers: { Authorization: `Bearer ${INDEX_KEY}` },
			},
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			events: Array<{ cursor: string; value: string }>;
			next_cursor: string | null;
			reorgs: unknown[];
		};
		expect(body.events).toMatchObject([
			{
				cursor: "1:3",
				value: "0x0100000000000000000000000000000001",
			},
		]);
		expect(body.next_cursor).toBe("1:3");
		expect(body.reorgs).toEqual([]);
	});
});
