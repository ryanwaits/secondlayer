import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { Subgraph } from "@secondlayer/shared/db";
import { getRawClient } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { _resetSlotCounterForTests } from "../lib/slot-counter.ts";
import { errorHandler } from "../middleware/error.ts";
import { type TableStreamOptions, handleTableStream } from "./read-core.ts";

const SKIP = !process.env.DATABASE_URL;
const PG_SCHEMA = "subgraph_test_read_core_stream";

const subgraph = {
	name: "test-read-core-stream",
	schema_name: PG_SCHEMA,
	definition: {
		schema: {
			listings: {
				columns: {
					seller: { type: "text" },
					price: { type: "uint" },
				},
			},
			scratch: {
				columns: {
					note: { type: "text" },
				},
			},
		},
	},
} as unknown as Subgraph;

type Frame = { event?: string; data: string; id?: string };

function parseFrames(raw: string): Frame[] {
	return raw
		.split("\n\n")
		.filter((block) => block.trim().length > 0)
		.map((block) => {
			const frame: Frame = { data: "" };
			const data: string[] = [];
			for (const line of block.split("\n")) {
				if (line.startsWith("event: ")) frame.event = line.slice(7);
				else if (line.startsWith("id: ")) frame.id = line.slice(4);
				else if (line.startsWith("data: ")) data.push(line.slice(6));
			}
			frame.data = data.join("\n");
			return frame;
		});
}

function openReader(res: Response) {
	const reader = (res.body as ReadableStream<Uint8Array>).getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let done = false;
	let pending: ReturnType<typeof reader.read> | null = null;
	async function step(untilMs: number): Promise<boolean> {
		pending ??= reader.read();
		const wait = Math.max(0, untilMs - Date.now());
		const chunk = await Promise.race([
			pending,
			new Promise<"timeout">((r) => setTimeout(() => r("timeout"), wait)),
		]);
		if (chunk === "timeout") return false;
		pending = null;
		if (chunk.done) done = true;
		else buffer += decoder.decode(chunk.value);
		return true;
	}
	return {
		async readUntil(
			predicate: (frames: Frame[]) => boolean,
			timeoutMs = 3_000,
		): Promise<Frame[]> {
			const deadline = Date.now() + timeoutMs;
			while (!done && !predicate(parseFrames(buffer))) {
				if (!(await step(deadline))) {
					throw new Error(`timeout; got: ${JSON.stringify(buffer)}`);
				}
			}
			return parseFrames(buffer);
		},
		async drain(ms: number): Promise<Frame[]> {
			const deadline = Date.now() + ms;
			while (!done && (await step(deadline))) {}
			return parseFrames(buffer);
		},
		get done() {
			return done;
		},
		cancel: () => reader.cancel(),
	};
}

function appWith(opts: TableStreamOptions) {
	const app = new Hono();
	app.onError(errorHandler);
	app.get("/:table/stream", (c) =>
		handleTableStream(c, subgraph, c.req.param("table"), opts),
	);
	return app;
}

const FAST = { pollMs: 20, heartbeatMs: 60_000 };

async function connectWhenFree(
	app: Hono,
	path: string,
	timeoutMs = 2_000,
): Promise<Response> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const res = await app.request(path);
		if (res.status !== 429 || Date.now() > deadline) return res;
		await Bun.sleep(10);
	}
}

async function createScratch() {
	await getRawClient().unsafe(`
		CREATE TABLE IF NOT EXISTS ${PG_SCHEMA}.scratch (
			"_id" SERIAL PRIMARY KEY,
			"_block_height" BIGINT NOT NULL,
			"_tx_id" TEXT NOT NULL,
			"_created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
			"note" TEXT
		)
	`);
}

async function insert(height: number, seller: string, price: number) {
	await getRawClient().unsafe(
		`INSERT INTO ${PG_SCHEMA}.listings ("_block_height", "_tx_id", "seller", "price") VALUES ($1, $2, $3, $4)`,
		[height, `tx-${height}-${seller}`, seller, price],
	);
}

describe.skipIf(SKIP)("handleTableStream", () => {
	beforeAll(async () => {
		const client = getRawClient();
		await client.unsafe(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`);
		await client.unsafe(`CREATE SCHEMA ${PG_SCHEMA}`);
		await client.unsafe(`
			CREATE TABLE ${PG_SCHEMA}.listings (
				"_id" SERIAL PRIMARY KEY,
				"_block_height" BIGINT NOT NULL,
				"_tx_id" TEXT NOT NULL,
				"_created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
				"seller" TEXT,
				"price" BIGINT
			)
		`);
		await insert(100, "SP_ALICE", 1);
		await insert(101, "SP_BOB", 2);
		await insert(102, "SP_ALICE", 3);
	});

	beforeEach(async () => {
		await _resetSlotCounterForTests();
	});

	afterAll(async () => {
		await getRawClient().unsafe(`DROP SCHEMA IF EXISTS ${PG_SCHEMA} CASCADE`);
	});

	test("unknown table returns 404 TABLE_NOT_FOUND", async () => {
		const res = await appWith(FAST).request("/nope/stream");
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ code: "TABLE_NOT_FOUND" });
	});

	test("unknown filter column returns 400 INVALID_COLUMN", async () => {
		const res = await appWith(FAST).request("/listings/stream?bogus=1");
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: "INVALID_COLUMN" });
	});

	test("live tail skips existing rows, streams new ones, stops on abort", async () => {
		const res = await appWith(FAST).request("/listings/stream");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const sse = openReader(res);
		await Bun.sleep(60);
		await insert(103, "SP_CAROL", 4);
		const frames = await sse.readUntil((f) => f.some((x) => x.data !== ""));
		const rows = frames.filter((f) => !f.event).map((f) => JSON.parse(f.data));
		expect(rows.map((r) => r.seller)).toEqual(["SP_CAROL"]);
		expect(frames[0]?.id).toBe(String(rows[0]._id));
		await sse.cancel();
	});

	test("?since replays rows at or after the height and honors filters", async () => {
		const res = await appWith(FAST).request(
			"/listings/stream?since=101&seller=SP_ALICE",
		);
		expect(res.status).toBe(200);
		const sse = openReader(res);
		await sse.readUntil((f) => f.length >= 1);
		const rows = (await sse.drain(100))
			.filter((f) => !f.event)
			.map((f) => JSON.parse(f.data));
		expect(rows.map((r) => [r.seller, Number(r._block_height)])).toEqual([
			["SP_ALICE", 102],
		]);
		await sse.cancel();
	});

	test("cap reached returns 429 with Retry-After until a stream closes", async () => {
		const app = appWith({ ...FAST, maxConnections: 1 });
		const first = await app.request("/listings/stream");
		expect(first.status).toBe(200);
		const sse = openReader(first);

		const busy = await app.request("/listings/stream");
		expect(busy.status).toBe(429);
		expect(busy.headers.get("retry-after")).toBe("5");
		expect(await busy.json()).toMatchObject({
			code: "RATE_LIMIT_ERROR",
			error:
				"This instance holds 1 live subgraph streams. Close one and retry.",
		});

		await sse.cancel();
		const next = await connectWhenFree(app, "/listings/stream");
		expect(next.status).toBe(200);
		await openReader(next).cancel();
	});

	test("maxAgeMs closes the stream after the rows with no extra frame and frees the slot", async () => {
		const app = appWith({ ...FAST, maxAgeMs: 50, maxConnections: 1 });
		const res = await app.request("/listings/stream?since=100");
		expect(res.status).toBe(200);
		const sse = openReader(res);
		const frames = await sse.readUntil(() => false);
		expect(sse.done).toBe(true);
		const nonPing = frames.filter((f) => f.event !== "ping");
		expect(nonPing.length).toBeGreaterThan(0);
		for (const frame of nonPing) {
			expect(frame.event).toBeUndefined();
			expect(JSON.parse(frame.data)._id).toBeDefined();
		}

		const next = await connectWhenFree(app, "/listings/stream");
		expect(next.status).toBe(200);
		await openReader(next).cancel();
	});

	test("query error mid-stream closes the stream and frees the slot", async () => {
		await createScratch();
		const app = appWith({ ...FAST, maxConnections: 1 });
		const res = await app.request("/scratch/stream");
		expect(res.status).toBe(200);
		const sse = openReader(res);
		await Bun.sleep(60);
		await getRawClient().unsafe(`DROP TABLE ${PG_SCHEMA}.scratch`);
		const frames = await sse.readUntil(() => false);
		expect(sse.done).toBe(true);
		expect(frames.filter((f) => f.event !== "ping")).toEqual([]);

		await createScratch();
		const next = await connectWhenFree(app, "/scratch/stream");
		expect(next.status).toBe(200);
		await openReader(next).cancel();
	});
});
