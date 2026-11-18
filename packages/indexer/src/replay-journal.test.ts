import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	checkReply,
	findStartSequence,
	parseArgs,
	replayJournal,
} from "./replay-journal.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const NETWORK = "replay-journal-test";

const BASE = ["--source-url", "postgres://x", "--indexer-url", "http://y"];

describe("parseArgs", () => {
	test("accepts a valid sequence-based invocation and trims the indexer url", () => {
		const args = parseArgs([
			"--source-url",
			"postgres://x",
			"--indexer-url",
			"http://y:3700/",
			"--from-sequence",
			"12",
		]);
		expect(args.indexerUrl).toBe("http://y:3700");
		expect(args.fromSequence).toBe("12");
		expect(args.apply).toBe(false);
		expect(args.margin).toBe(200);
		expect(args.pageSize).toBe(500);
	});

	test("rejects a missing --source-url", () => {
		expect(() =>
			parseArgs(["--indexer-url", "http://y", "--from-sequence", "0"]),
		).toThrow("--source-url");
	});

	test("rejects giving both --from-sequence and --from-height", () => {
		expect(() =>
			parseArgs([...BASE, "--from-sequence", "1", "--from-height", "2"]),
		).toThrow("exactly one");
	});

	test("rejects giving neither --from-sequence nor --from-height", () => {
		expect(() => parseArgs(BASE)).toThrow("exactly one");
	});

	test("rejects a non-numeric sequence", () => {
		expect(() => parseArgs([...BASE, "--from-sequence", "12a"])).toThrow(
			"digits",
		);
	});

	test("rejects an unknown flag", () => {
		expect(() =>
			parseArgs([...BASE, "--from-sequence", "1", "--nope"]),
		).toThrow("Unknown flag");
	});

	test("rejects a page size outside 1..5000", () => {
		expect(() =>
			parseArgs([...BASE, "--from-sequence", "1", "--page-size", "5001"]),
		).toThrow("--page-size");
	});
});

describe("checkReply", () => {
	test("accepts every applied reply for /new_block", () => {
		for (const status of ["ok", "duplicate", "staged"]) {
			expect(checkReply("/new_block", 200, { status }).ok).toBe(true);
		}
	});

	test("accepts ok for /new_burn_block", () => {
		expect(checkReply("/new_burn_block", 200, { status: "ok" }).ok).toBe(true);
	});

	test("rejects accepted and points at INGEST_MODE=live", () => {
		const verdict = checkReply("/new_block", 200, { status: "accepted" });
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) expect(verdict.reason).toContain("INGEST_MODE=live");
	});

	test("rejects spooled, error replies, and duplicate on /new_burn_block", () => {
		expect(checkReply("/new_block", 200, { status: "spooled" }).ok).toBe(false);
		expect(
			checkReply("/new_block", 500, { status: "error", message: "boom" }).ok,
		).toBe(false);
		expect(checkReply("/new_burn_block", 200, { status: "duplicate" }).ok).toBe(
			false,
		);
		expect(checkReply("/new_block", 200, null).ok).toBe(false);
	});

	test("rejects a non-200 reply even when the status looks applied", () => {
		expect(checkReply("/new_block", 500, { status: "ok" }).ok).toBe(false);
	});
});

type Recorded = { path: string; source: string | null; body: string };

describe.skipIf(!HAS_DB)("replayJournal", () => {
	const requests: Recorded[] = [];
	let replies: Array<{ status?: number; body: unknown }> = [];
	const defaultReply = { body: { status: "ok" } };

	const handler = (path: string) => async (req: Request) => {
		requests.push({
			path,
			source: req.headers.get("X-Source"),
			body: await req.text(),
		});
		const reply = replies[requests.length - 1] ?? defaultReply;
		return Response.json(reply.body, { status: reply.status ?? 200 });
	};

	const server = Bun.serve({
		port: 0,
		routes: {
			"/new_block": { POST: handler("/new_block") },
			"/new_burn_block": { POST: handler("/new_burn_block") },
		},
		fetch: () => new Response("not found", { status: 404 }),
	});
	if (server.port === undefined) throw new Error("server did not bind a port");
	const indexerUrl = `http://127.0.0.1:${server.port}`;

	const cleanup = () =>
		getDb()
			.deleteFrom("observer_journal")
			.where("network", "=", NETWORK)
			.execute();

	beforeEach(async () => {
		requests.length = 0;
		replies = [];
		await cleanup();
	});

	afterAll(async () => {
		server.stop(true);
		await cleanup();
	});

	async function insert(
		path: string,
		status: string,
		body: unknown,
		blockHeight: number | null = null,
	): Promise<string> {
		const row = await getDb()
			.insertInto("observer_journal")
			.values({
				network: NETWORK,
				path,
				source: "test",
				raw_body: Buffer.from(
					typeof body === "string" ? body : JSON.stringify(body),
				),
				raw_body_sha256: "test",
				status: status as never,
				block_height: blockHeight,
			})
			.returning("sequence")
			.executeTakeFirstOrThrow();
		return String(row.sequence);
	}

	const run = (over: Partial<Parameters<typeof replayJournal>[0]> = {}) =>
		replayJournal({
			db: getDb(),
			indexerUrl,
			network: NETWORK,
			afterSequence: "0",
			pageSize: 500,
			timeoutMs: 5000,
			apply: true,
			log: () => {},
			...over,
		});

	test("replays block and burn-block bodies in sequence order, byte for byte", async () => {
		// Odd spacing proves the body is forwarded verbatim, not re-serialized.
		const bodies = [
			'{"block_height":  1,"z":1,"a":2}',
			'{"burn_block_height":1 }',
			'{"block_height":2}',
		];
		const s1 = await insert("/new_block", "processed", bodies[0], 1);
		await insert("/new_burn_block", "processed", bodies[1]);
		const s3 = await insert("/new_block", "received", bodies[2]);
		await insert("/new_mempool_tx", "processed", { tx: 1 });
		expect(BigInt(s3)).toBeGreaterThan(BigInt(s1));

		const summary = await run();

		expect(requests.map((r) => r.path)).toEqual([
			"/new_block",
			"/new_burn_block",
			"/new_block",
		]);
		expect(requests.map((r) => r.body)).toEqual(bodies);
		expect(requests.every((r) => r.source === "journal-replay")).toBe(true);
		expect(summary.lastSequence).toBe(s3);
		expect(summary.replayed).toBe(3);
	});

	test("skips failed, retried, skipped and poisoned rows and counts them", async () => {
		await insert("/new_block", "failed", { n: 1 });
		await insert("/new_block", "retried", { n: 2 });
		await insert("/new_block", "skipped", { n: 3 });
		await insert("/new_block", "poisoned", { n: 4 });
		await insert("/new_block", "processed", { n: 5 }, 5);

		const summary = await run();

		expect(requests).toHaveLength(1);
		expect(summary.skipped).toEqual({
			failed: 1,
			retried: 1,
			skipped: 1,
			poisoned: 1,
		});
	});

	test("stops at an accepted reply and reports where to resume", async () => {
		const s1 = await insert("/new_block", "processed", { n: 1 }, 1);
		const s2 = await insert("/new_block", "processed", { n: 2 }, 2);
		await insert("/new_block", "processed", { n: 3 }, 3);
		replies = [{ body: { status: "ok" } }, { body: { status: "accepted" } }];

		let message = "";
		await run().catch((error: Error) => {
			message = error.message;
		});

		expect(message).toContain("INGEST_MODE=live");
		expect(message).toContain(`sequence=${s2}`);
		expect(message).toContain(`last_sequence=${s1}`);
		expect(requests).toHaveLength(2);
	});

	test("dry-run sends nothing", async () => {
		await insert("/new_block", "processed", { n: 1 }, 1);
		await insert("/new_burn_block", "processed", { n: 2 });
		await insert("/new_block", "failed", { n: 3 });

		const summary = await run({ apply: false });

		expect(requests).toHaveLength(0);
		expect(summary.replayed).toBe(2);
	});

	test("resumes after the given sequence", async () => {
		const s1 = await insert("/new_block", "processed", { n: 1 }, 1);
		await insert("/new_block", "processed", { n: 2 }, 2);

		await run({ afterSequence: s1 });

		expect(requests.map((r) => r.body)).toEqual(['{"n":2}']);
	});

	test("stops after --to-sequence inclusive", async () => {
		await insert("/new_block", "processed", { n: 1 }, 1);
		const s2 = await insert("/new_block", "processed", { n: 2 }, 2);
		await insert("/new_block", "processed", { n: 3 }, 3);

		await run({ toSequence: s2 });

		expect(requests).toHaveLength(2);
	});

	test("pages through more rows than one page", async () => {
		for (let n = 1; n <= 5; n++) {
			await insert("/new_block", "processed", { n }, n);
		}

		const summary = await run({ pageSize: 2 });

		expect(requests.map((r) => r.body)).toEqual([
			'{"n":1}',
			'{"n":2}',
			'{"n":3}',
			'{"n":4}',
			'{"n":5}',
		]);
		expect(summary.replayed).toBe(5);
	});

	test("findStartSequence returns the row just below the first block at height minus margin", async () => {
		await insert("/new_block", "processed", { n: 100 }, 100);
		const s150 = await insert("/new_block", "processed", { n: 150 }, 150);
		await insert("/new_block", "processed", { n: 200 }, 200);

		const start = await findStartSequence(getDb(), {
			network: NETWORK,
			fromHeight: 180,
			margin: 40,
		});
		expect(start).toBe(String(BigInt(s150) - 1n));

		await run({ afterSequence: start as string });
		expect(requests.map((r) => r.body)).toEqual(['{"n":150}', '{"n":200}']);

		expect(
			await findStartSequence(getDb(), {
				network: NETWORK,
				fromHeight: 1000,
				margin: 40,
			}),
		).toBeNull();
	});
});
