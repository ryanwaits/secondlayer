import { beforeEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { consumeFtTransferDecodedEvents } from "@secondlayer/indexer/l2/decoder";
import { createHttpStreamsEventsFetcher } from "@secondlayer/indexer/l2/streams-client";
import { STREAMS_READ_SCOPE, type StreamsTokenStore } from "./auth.ts";
import { errorHandler } from "../middleware/error.ts";
import { createStreamsRouter } from "../routes/streams.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const INTERNAL_STREAMS_KEY = "sk-sl_streams_l2_enterprise_test";
const INTERNAL_STREAMS_TOKENS: StreamsTokenStore = new Map([
	[
		INTERNAL_STREAMS_KEY,
		{
			tenant_id: "tenant_streams_l2_internal",
			tier: "enterprise",
			scopes: [STREAMS_READ_SCOPE],
		},
	],
]);

describe.skipIf(!HAS_DB)("L2 ft_transfer decoder dogfoods Streams", () => {
	const db = HAS_DB ? getDb() : null;

	beforeEach(async () => {
		if (!db) return;
		await sql`DELETE FROM decoded_events`.execute(db);
		await sql`DELETE FROM l2_decoder_checkpoints`.execute(db);
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
			])
			.execute();
	});

	function inProcessFetcher() {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/v1/streams",
			createStreamsRouter({
				tokens: INTERNAL_STREAMS_TOKENS,
				getTip: () => ({
					block_height: 1,
					index_block_hash: "0x01",
					burn_block_height: 101,
					lag_seconds: 0,
				}),
			}),
		);

		return createHttpStreamsEventsFetcher({
			baseUrl: "http://secondlayer.test",
			apiKey: INTERNAL_STREAMS_KEY,
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				return app.fetch(request);
			},
		});
	}

	test("rejects the decoder when its internal Streams key is not authorized", async () => {
		if (!db) throw new Error("missing db");

		await expect(
			consumeFtTransferDecodedEvents({
				db,
				fetchEvents: createHttpStreamsEventsFetcher({
					baseUrl: "http://secondlayer.test",
					apiKey: "sk-sl_streams_bad_internal_test",
					fetchImpl: async (input, init) => {
						const app = new Hono();
						app.onError(errorHandler);
						app.route(
							"/v1/streams",
							createStreamsRouter({
								tokens: INTERNAL_STREAMS_TOKENS,
								getTip: () => ({
									block_height: 1,
									index_block_hash: "0x01",
									burn_block_height: 101,
									lag_seconds: 0,
								}),
							}),
						);
						const request =
							input instanceof Request
								? input
								: new Request(input.toString(), init);
						return app.fetch(request);
					},
				}),
				maxPages: 1,
			}),
		).rejects.toThrow("Streams /events returned 401");
	});

	test("consumes /events in-process and writes decoded ft_transfer rows", async () => {
		if (!db) throw new Error("missing db");

		const result = await consumeFtTransferDecodedEvents({
			db,
			fetchEvents: inProcessFetcher(),
			batchSize: 10,
			maxPages: 1,
		});

		const rows = await db
			.selectFrom("decoded_events")
			.selectAll()
			.orderBy("cursor")
			.execute();

		expect(result.decoded).toBe(2);
		expect(rows.map((row) => row.cursor)).toEqual(["1:0", "1:2"]);
		expect(rows.map((row) => row.source_cursor)).toEqual(["1:0", "1:2"]);
		expect(rows[0]?.decoded_payload).toEqual({
			asset_identifier: "SP1.token::sbtc",
			contract_id: "SP1.token",
			token_name: "sbtc",
			sender: "SP1",
			recipient: "SP2",
			amount: "10",
		});
	});

	test("restart resumes from checkpoint without duplicates or gaps", async () => {
		if (!db) throw new Error("missing db");
		const fetchEvents = inProcessFetcher();

		await consumeFtTransferDecodedEvents({
			db,
			fetchEvents,
			batchSize: 1,
			maxPages: 1,
		});
		await consumeFtTransferDecodedEvents({
			db,
			fetchEvents,
			batchSize: 1,
			maxPages: 2,
		});

		const rows = await db
			.selectFrom("decoded_events")
			.select(["cursor", "source_cursor"])
			.orderBy("cursor")
			.execute();
		const checkpoint = await db
			.selectFrom("l2_decoder_checkpoints")
			.select("last_cursor")
			.where("decoder_name", "=", "l2.ft_transfer.v1")
			.executeTakeFirst();

		expect(rows).toEqual([
			{ cursor: "1:0", source_cursor: "1:0" },
			{ cursor: "1:2", source_cursor: "1:2" },
		]);
		expect(checkpoint?.last_cursor).toBe("1:2");
	});
});
