import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { type Kysely, sql } from "kysely";
import { errorHandler } from "../../packages/api/src/middleware/error.ts";
import { createStreamsRouter } from "../../packages/api/src/routes/streams.ts";
import { readCanonicalStreamsEvents } from "../../packages/indexer/src/streams-events.ts";
import type { Database } from "../../packages/shared/src/db/types.ts";
import {
	type ContinuousServiceProgress,
	createSmokeDatabase,
	getFreePort,
	runContinuousServiceSmoke,
	spawnContinuousService,
} from "./continuous-service.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SERVICE_NAME = "l2-decoder";
const EXPECTED_EVENT_TYPE = "ft_transfer";
const DECODER_NAME = "l2.ft_transfer.v1";
const SMOKE_TIMEOUT_MS = 95_000;

describe("continuous service smoke: l2-decoder", () => {
	test(
		"runs for at least 60s and advances decoded output",
		async () => {
			const smokeDb = await createSmokeDatabase("secondlayer_smoke_l2_decoder");
			let apiServer: ReturnType<typeof Bun.serve> | null = null;

			try {
				const apiPort = await getFreePort();
				const servicePort = await getFreePort();
				apiServer = Bun.serve({
					hostname: "127.0.0.1",
					port: apiPort,
					fetch: createStreamsApi(smokeDb.db).fetch,
				});

				const summary = await runContinuousServiceSmoke({
					serviceName: SERVICE_NAME,
					outputTable: "decoded_events",
					expectedEventType: EXPECTED_EVENT_TYPE,
					checkpointLabel: "l2_decoder_checkpoints",
					timeoutMs: SMOKE_TIMEOUT_MS,
					pollIntervalMs: 1_000,
					minimumOutputWrites: 2,
					minimumExpectedEventTypeRows: 2,
					seed: () => seedL2DecoderSourceFeed(smokeDb.db),
					startService: () =>
						spawnContinuousService({
							command: ["bun", "run", "packages/indexer/src/l2/service.ts"],
							cwd: REPO_ROOT,
							env: {
								DATABASE_URL: smokeDb.url,
								STREAMS_API_URL: `http://127.0.0.1:${apiPort}`,
								STREAMS_INTERNAL_API_KEY: "sk-sl_streams_l2_internal",
								PORT: String(servicePort),
								L2_DECODER_BATCH_SIZE: "1",
								L2_DECODER_EMPTY_BACKOFF_MS: "250",
								DATABASE_POOL_MAX: "4",
								LOG_LEVEL: "warn",
								NODE_ENV: "test",
							},
						}),
					readProgress: () => readL2DecoderProgress(smokeDb.db),
				});

				console.info(
					`[l2-decoder smoke] rows_written=${summary.outputRowsWritten} checkpoint_delta=${summary.checkpointDelta.before ?? "null"}->${summary.checkpointDelta.after ?? "null"} event_type_counts=${JSON.stringify(summary.after.eventTypeCounts ?? {})}`,
				);
				expect(summary.elapsedMs).toBeGreaterThanOrEqual(60_000);
				expect(
					summary.after.eventTypeCounts?.ft_transfer ?? 0,
				).toBeGreaterThanOrEqual(2);
				expect(
					summary.after.eventTypeCounts?.nft_transfer ?? 0,
				).toBeGreaterThanOrEqual(1);
			} finally {
				apiServer?.stop();
				await smokeDb.drop();
			}
		},
		SMOKE_TIMEOUT_MS + 10_000,
	);
});

function createStreamsApi(db: Kysely<Database>): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/streams",
		createStreamsRouter({
			getTip: async () => {
				const tip = await db
					.selectFrom("blocks")
					.select(["height", "hash", "burn_block_height"])
					.where("canonical", "=", true)
					.orderBy("height", "desc")
					.executeTakeFirstOrThrow();
				return {
					block_height: Number(tip.height),
					index_block_hash: tip.hash,
					burn_block_height: Number(tip.burn_block_height),
					lag_seconds: 0,
				};
			},
			readEvents: (params) => readCanonicalStreamsEvents({ ...params, db }),
		}),
	);
	return app;
}

async function seedL2DecoderSourceFeed(db: Kysely<Database>): Promise<void> {
	await db
		.insertInto("blocks")
		.values([
			{
				height: 1,
				hash: "0xsmoke01",
				parent_hash: "0xsmoke00",
				burn_block_height: 101,
				timestamp: 1_800_000_000,
				canonical: true,
			},
			{
				height: 2,
				hash: "0xsmoke02",
				parent_hash: "0xsmoke01",
				burn_block_height: 102,
				timestamp: 1_800_000_010,
				canonical: true,
			},
		])
		.execute();

	await db
		.insertInto("transactions")
		.values([
			{
				tx_id: "tx-smoke-ft-1",
				block_height: 1,
				tx_index: 0,
				type: "token_transfer",
				sender: "SP1SMOKE",
				status: "success",
				contract_id: null,
				raw_tx: "0x01",
			},
			{
				tx_id: "tx-smoke-print",
				block_height: 1,
				tx_index: 1,
				type: "contract_call",
				sender: "SP2SMOKE",
				status: "success",
				contract_id: "SP2SMOKE.print",
				raw_tx: "0x02",
			},
			{
				tx_id: "tx-smoke-ft-2",
				block_height: 1,
				tx_index: 2,
				type: "token_transfer",
				sender: "SP3SMOKE",
				status: "success",
				contract_id: null,
				raw_tx: "0x03",
			},
			{
				tx_id: "tx-smoke-ft-3",
				block_height: 2,
				tx_index: 0,
				type: "token_transfer",
				sender: "SP5SMOKE",
				status: "success",
				contract_id: null,
				raw_tx: "0x04",
			},
			{
				tx_id: "tx-smoke-nft-1",
				block_height: 2,
				tx_index: 1,
				type: "contract_call",
				sender: "SP7SMOKE",
				status: "success",
				contract_id: "SP7SMOKE.collection",
				raw_tx: "0x05",
			},
		])
		.execute();

	await db
		.insertInto("events")
		.values([
			{
				tx_id: "tx-smoke-ft-1",
				block_height: 1,
				event_index: 0,
				type: "ft_transfer_event",
				data: {
					asset_identifier: "SP1SMOKE.token::SMOKE",
					sender: "SP1SMOKE",
					recipient: "SP2SMOKE",
					amount: "10",
				},
			},
			{
				tx_id: "tx-smoke-print",
				block_height: 1,
				event_index: 0,
				type: "smart_contract_event",
				data: {
					contract_identifier: "SP2SMOKE.print",
					topic: "print",
					value: { repr: "u1" },
				},
			},
			{
				tx_id: "tx-smoke-ft-2",
				block_height: 1,
				event_index: 0,
				type: "ft_transfer_event",
				data: {
					asset_identifier: "SP3SMOKE.token::SMOKE",
					sender: "SP3SMOKE",
					recipient: "SP4SMOKE",
					amount: "20",
				},
			},
			{
				tx_id: "tx-smoke-ft-3",
				block_height: 2,
				event_index: 0,
				type: "ft_transfer_event",
				data: {
					asset_identifier: "SP5SMOKE.token::SMOKE",
					sender: "SP5SMOKE",
					recipient: "SP6SMOKE",
					amount: "30",
				},
			},
			{
				tx_id: "tx-smoke-nft-1",
				block_height: 2,
				event_index: 0,
				type: "nft_transfer_event",
				data: {
					asset_identifier: "SP7SMOKE.collection::SMOKE",
					sender: "SP7SMOKE",
					recipient: "SP8SMOKE",
					value: "0x0100000000000000000000000000000001",
				},
			},
		])
		.execute();
}

async function readL2DecoderProgress(
	db: Kysely<Database>,
): Promise<ContinuousServiceProgress> {
	const outputRows = await countSql(
		db,
		sql`SELECT count(*)::int AS count FROM decoded_events`,
	);
	const expectedEventTypeRows = await countSql(
		db,
		sql`SELECT count(*)::int AS count FROM decoded_events WHERE event_type = ${EXPECTED_EVENT_TYPE}`,
	);
	const checkpoint = await db
		.selectFrom("l2_decoder_checkpoints")
		.select("last_cursor")
		.where("decoder_name", "=", DECODER_NAME)
		.executeTakeFirst();
	const eventTypeCounts = await readEventTypeCounts(db);

	return {
		outputRows,
		expectedEventTypeRows,
		checkpoint: checkpoint?.last_cursor ?? null,
		eventTypeCounts,
	};
}

async function countSql(
	db: Kysely<Database>,
	query: ReturnType<typeof sql<{ count: string | number }>>,
): Promise<number> {
	const result = await query.execute(db);
	return Number(result.rows[0]?.count ?? 0);
}

async function readEventTypeCounts(
	db: Kysely<Database>,
): Promise<Record<string, number>> {
	const result = await sql<{ event_type: string; count: string | number }>`
		SELECT event_type, count(*)::int AS count
		FROM decoded_events
		GROUP BY event_type
		ORDER BY event_type
	`.execute(db);

	return Object.fromEntries(
		result.rows.map((row) => [row.event_type, Number(row.count)]),
	);
}
