import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
	IMMUTABLE_CACHE_CONTROL,
	MUTABLE_CACHE_CONTROL,
} from "../http/cache.ts";
import { errorHandler } from "../middleware/error.ts";
import { createIndexRouter } from "../routes/index.ts";
import type { CanonicalRangeReader } from "./canonical.ts";
import type { ContractCallsReader } from "./contract-calls.ts";
import type { IndexEventsReader } from "./events.ts";
import type { FtTransfersReader } from "./ft-transfers.ts";
import type { NftTransfersReader } from "./nft-transfers.ts";
import type { IndexTip } from "./tip.ts";

const TIP: IndexTip = {
	block_height: 10_000,
	finalized_height: 9_994,
	lag_seconds: 0,
};

const ONE_EVENT: IndexEventsReader = async () => ({
	events: [
		{
			cursor: "9000:0",
			block_height: 9000,
			block_time: "2026-05-01T00:00:00.000Z",
			tx_id: "0x01",
			tx_index: 0,
			event_index: 0,
			event_type: "ft_transfer",
			contract_id: "SP123.token",
			asset_identifier: "SP123.token::coin",
			sender: "SP1",
			recipient: "SP2",
			amount: "1",
		},
	],
	next_cursor: "9000:0",
});

const ONE_FT: FtTransfersReader = async () => ({
	events: [
		{
			cursor: "9000:0",
			block_height: 9000,
			tx_id: "0x01",
			tx_index: 0,
			event_index: 0,
			event_type: "ft_transfer",
			contract_id: "SP123.token",
			asset_identifier: "SP123.token::coin",
			sender: "SP1",
			recipient: "SP2",
			amount: "1",
		},
	],
	next_cursor: "9000:0",
});

const ONE_NFT: NftTransfersReader = async () => ({
	events: [
		{
			cursor: "9000:0",
			block_height: 9000,
			tx_id: "0x02",
			tx_index: 0,
			event_index: 0,
			event_type: "nft_transfer",
			contract_id: "SP123.collection",
			asset_identifier: "SP123.collection::token",
			sender: "SP1",
			recipient: "SP2",
			value: "0x01",
		},
	],
	next_cursor: "9000:0",
});

const ONE_CALL: ContractCallsReader = async () => ({
	contract_calls: [
		{
			cursor: "9000:0",
			block_height: 9000,
			tx_id: "0x03",
			tx_index: 0,
			contract_id: "SP123.amm",
			function_name: "swap",
			sender: "SP1",
			status: "success",
			args: [],
			result: null,
			result_hex: null,
		},
	],
	next_cursor: "9000:0",
});

const ONE_CANONICAL: CanonicalRangeReader = async () => ({
	canonical: [
		{
			cursor: "9000:0",
			block_height: 9000,
			block_hash: "0x9000",
			parent_hash: "0x8999",
			burn_block_height: 19_000,
			burn_block_hash: "0xb9000",
		},
	],
	next_cursor: "9000:0",
});

function createApp(readEvents: IndexEventsReader = ONE_EVENT) {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/v1/index",
		createIndexRouter({
			getTip: () => TIP,
			readEvents,
			readFtTransfers: ONE_FT,
			readNftTransfers: ONE_NFT,
			readContractCalls: ONE_CALL,
			readCanonical: ONE_CANONICAL,
			readReorgs: async () => [],
		}),
	);
	return app;
}

const FINALIZED =
	"/v1/index/events?event_type=ft_transfer&from_height=0&to_height=9994";
const TIP_SPANNING = "/v1/index/events?event_type=ft_transfer&from_height=0";

describe("Index events caching", () => {
	test("a finalized range is immutable and carries an ETag", async () => {
		const res = await createApp().request(FINALIZED);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
		expect(res.headers.get("ETag")).toMatch(/^W\/".+"$/);
	});

	test("If-None-Match on a finalized page short-circuits to 304", async () => {
		const app = createApp();
		const first = await app.request(FINALIZED);
		const etag = first.headers.get("ETag");
		expect(etag).not.toBeNull();

		const second = await app.request(FINALIZED, {
			headers: { "If-None-Match": etag as string },
		});
		expect(second.status).toBe(304);
		expect(await second.text()).toBe("");
	});

	test("a tip-spanning range is mutable, has no ETag, and never 304s", async () => {
		const app = createApp();
		const res = await app.request(TIP_SPANNING);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe(MUTABLE_CACHE_CONTROL);
		expect(res.headers.get("ETag")).toBeNull();

		// A spoofed conditional must not short-circuit a still-mutable page.
		const conditional = await app.request(TIP_SPANNING, {
			headers: { "If-None-Match": "*" },
		});
		expect(conditional.status).toBe(200);
	});
});

// Every Index read route shares the same finality-gated cache wiring.
describe.each([
	["ft-transfers", "/v1/index/ft-transfers"],
	["nft-transfers", "/v1/index/nft-transfers"],
	["contract-calls", "/v1/index/contract-calls"],
	["canonical", "/v1/index/canonical"],
])("Index %s caching", (_name, path) => {
	const finalized = `${path}?from_height=0&to_height=9994`;
	const tipSpanning = `${path}?from_height=0`;

	test("finalized range is immutable with a 304 round-trip", async () => {
		const app = createApp();
		const res = await app.request(finalized);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE_CACHE_CONTROL);
		const etag = res.headers.get("ETag");
		expect(etag).not.toBeNull();

		const conditional = await app.request(finalized, {
			headers: { "If-None-Match": etag as string },
		});
		expect(conditional.status).toBe(304);
	});

	test("tip-spanning range is mutable with no ETag", async () => {
		const res = await createApp().request(tipSpanning);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe(MUTABLE_CACHE_CONTROL);
		expect(res.headers.get("ETag")).toBeNull();
	});
});

describe("Index canonical route", () => {
	test("returns the canonical map envelope", async () => {
		const res = await createApp().request(
			"/v1/index/canonical?from_height=0&to_height=9994",
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			canonical: Array<{ block_height: number; block_hash: string }>;
			next_cursor: string | null;
			tip: { block_height: number };
		};
		expect(body.canonical[0]).toMatchObject({
			block_height: 9000,
			block_hash: "0x9000",
			parent_hash: "0x8999",
		});
		expect(body.next_cursor).toBe("9000:0");
		expect(body.tip.block_height).toBe(10_000);
		// Lean sync primitive: no reorgs[] field.
		expect(body).not.toHaveProperty("reorgs");
	});

	test("is listed in route discovery", async () => {
		const res = await createApp().request("/v1/index");
		const body = (await res.json()) as {
			routes: Array<{ path: string }>;
		};
		expect(body.routes.map((r) => r.path)).toContain("/v1/index/canonical");
	});
});
