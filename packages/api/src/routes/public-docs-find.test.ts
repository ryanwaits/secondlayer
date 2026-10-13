import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { logger } from "@secondlayer/shared";
import { Hono } from "hono";
import {
	InProcRateLimitStore,
	_resetRateLimitStoreForTests,
} from "../auth/rate-limit-store.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	type VectorFile,
	createDocsFindRouter,
	createVectorSource,
	decodeVectors,
	nearest,
	unitPrefix,
} from "./public-docs-find.ts";

afterEach(async () => {
	await _resetRateLimitStoreForTests();
});

const DIMS = 4;

/** Unit-length int8 row, scaled the way `docs:vectors` writes it. */
function row(id: string, v: number[]): VectorFile["items"][number] {
	const norm = Math.hypot(...v);
	const unit = v.map((x) => x / norm);
	const peak = Math.max(...unit.map(Math.abs));
	const ints = Int8Array.from(unit, (x) => Math.round((x / peak) * 127));
	const length = Math.hypot(...Array.from(ints, (i) => (i * peak) / 127));
	return {
		id,
		hash: "h",
		scale: peak / 127 / length,
		q: Buffer.from(ints.buffer).toString("base64"),
	};
}

const FILE: VectorFile = {
	model: "test/embed",
	dims: DIMS,
	items: [
		row("docs:/docs/streams#reorgs", [1, 0, 0, 0]),
		row("docs:/docs/streams#cursors", [0, 1, 0, 0]),
		row("docs:/docs/webhooks", [0.7, 0.7, 0, 0]),
		row("docs:/docs/devnet", [0, 0, 0, 1]),
	],
};
const INDEX = decodeVectors(FILE);

function router(opts: {
	vector?: number[] | "fail";
	index?: typeof INDEX | null;
	onEmbed?: (input: { model: string; value: string }) => void;
}) {
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/api/public/docs-find",
		createDocsFindRouter({
			rateLimitStore: new InProcRateLimitStore(),
			vectors: async () => (opts.index === undefined ? INDEX : opts.index),
			embedQuery: async ({ model, value }) => {
				opts.onEmbed?.({ model, value });
				if (opts.vector === "fail") throw new Error("gateway down");
				// A longer vector, as a full-size embedding: only the prefix counts.
				return [...(opts.vector ?? [1, 0.1, 0, 0]), 9, 9, 9];
			},
		}),
	);
	return app;
}

function post(app: Hono, body: unknown, headers: Record<string, string> = {}) {
	return app.request("/api/public/docs-find", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

describe("decodeVectors and nearest", () => {
	test("int8 rows come back unit length and rank by cosine", () => {
		for (let r = 0; r < INDEX.ids.length; r++) {
			let sum = 0;
			for (let d = 0; d < DIMS; d++) sum += INDEX.matrix[r * DIMS + d] ** 2;
			expect(sum).toBeCloseTo(1, 3);
		}
		const top = nearest(INDEX, unitPrefix([1, 0.1, 0, 0, 5], DIMS), 3);
		expect(top.map((t) => t.id)).toEqual([
			"docs:/docs/streams#reorgs",
			"docs:/docs/webhooks",
			"docs:/docs/streams#cursors",
		]);
		expect(top[0].cos).toBeCloseTo(0.995, 2);
	});

	test("rows of the wrong length are dropped, not decoded into noise", () => {
		const bad = decodeVectors({
			...FILE,
			items: [...FILE.items, { id: "x", hash: "h", scale: 1, q: "AAAA" }],
		});
		expect(bad.ids).not.toContain("x");
	});
});

describe("POST /api/public/docs-find", () => {
	test("refuses a missing, short, long or non-string q", async () => {
		const app = router({});
		for (const body of [{}, { q: "ab" }, { q: "x".repeat(201) }, { q: 42 }]) {
			expect((await post(app, body)).status).toBe(400);
		}
		expect((await post(app, "{not json")).status).toBe(400);
	});

	test("embeds the query with the vectors' model and returns ranked ids with cosines", async () => {
		let seen = { model: "", value: "" };
		const res = await post(
			router({
				onEmbed: (i) => {
					seen = i;
				},
			}),
			{ q: "  why are my rows doubled after a fork " },
		);
		expect(res.status).toBe(200);
		expect(seen).toEqual({
			model: "test/embed",
			value: "why are my rows doubled after a fork",
		});
		const { results } = (await res.json()) as {
			results: { id: string; cos: number }[];
		};
		expect(results.map((r) => r.id)).toEqual([
			"docs:/docs/streams#reorgs",
			"docs:/docs/webhooks",
			"docs:/docs/streams#cursors",
			"docs:/docs/devnet",
		]);
		expect(results[0].cos).toBeGreaterThan(results[1].cos);
	});

	test("returns at most 30 results", async () => {
		const many = decodeVectors({
			...FILE,
			items: Array.from({ length: 50 }, (_, i) =>
				row(`docs:/docs/p${i}`, [1, i / 50, 0, 0]),
			),
		});
		const res = await post(router({ index: many }), { q: "any question" });
		const { results } = (await res.json()) as { results: unknown[] };
		expect(results).toHaveLength(30);
	});

	test("an embedding failure or missing vectors answers an empty list with 200", async () => {
		const failed = await post(router({ vector: "fail" }), {
			q: "any question",
		});
		expect(failed.status).toBe(200);
		expect(await failed.json()).toEqual({ results: [] });
		const none = await post(router({ index: null }), { q: "any question" });
		expect(none.status).toBe(200);
		expect(await none.json()).toEqual({ results: [] });
	});

	test("a vector shorter than the index dims is a failure, not a NaN ranking", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.route(
			"/api/public/docs-find",
			createDocsFindRouter({
				rateLimitStore: new InProcRateLimitStore(),
				vectors: async () => INDEX,
				embedQuery: async () => [1, 0],
			}),
		);
		expect(await (await post(app, { q: "any question" })).json()).toEqual({
			results: [],
		});
	});

	test("repeats of a query, any case or spacing, are answered without a second model call", async () => {
		let calls = 0;
		const app = router({ onEmbed: () => calls++ });
		await post(app, { q: "Why are rows doubled" });
		await post(app, { q: "  why   ARE rows   doubled " });
		expect(calls).toBe(1);
	});

	test("a failed call is not cached", async () => {
		let calls = 0;
		const app = router({ vector: "fail", onEmbed: () => calls++ });
		await post(app, { q: "any question" });
		await post(app, { q: "any question" });
		expect(calls).toBe(2);
	});

	test("refuses the 31st search in a minute from one address with 429", async () => {
		const app = router({});
		const headers = { "x-forwarded-for": "203.0.113.9" };
		for (let i = 0; i < 30; i++) {
			expect((await post(app, { q: `question ${i}` }, headers)).status).toBe(
				200,
			);
		}
		const over = await post(app, { q: "one more" }, headers);
		expect(over.status).toBe(429);
		expect(over.headers.get("retry-after")).not.toBeNull();
		const other = await post(
			app,
			{ q: "one more" },
			{ "x-forwarded-for": "203.0.113.10" },
		);
		expect(other.status).toBe(200);
	});

	test("requests with no trusted address share one bucket", async () => {
		const app = router({});
		for (let i = 0; i < 30; i++) await post(app, { q: `question ${i}` });
		expect((await post(app, { q: "one more" })).status).toBe(429);
	});

	test("the query never reaches the logger, on success or failure", async () => {
		const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
			spyOn(logger, level).mockImplementation(() => {}),
		);
		try {
			const q = "zq-secret-phrase-7731";
			await post(router({}), { q });
			await post(router({ vector: "fail" }), { q: `${q} again` });
			const logged = spies
				.flatMap((s) => s.mock.calls)
				.map((c) => JSON.stringify(c));
			expect(logged.length).toBeGreaterThan(0);
			for (const line of logged) expect(line).not.toContain("zq-secret");
		} finally {
			for (const s of spies) s.mockRestore();
		}
	});
});

describe("createVectorSource", () => {
	const ok = () => Response.json(FILE);

	test("serves the fetched vectors for ten minutes, then refetches", async () => {
		let fetches = 0;
		let t = 0;
		const get = createVectorSource({
			fetchImpl: (async () => {
				fetches++;
				return ok();
			}) as unknown as typeof fetch,
			now: () => t,
		});
		await get();
		t = 599_000;
		await get();
		expect(fetches).toBe(1);
		t = 601_000;
		await get();
		expect(fetches).toBe(2);
	});

	test("keeps the last good vectors when a refetch fails, and has none when the first fetch fails", async () => {
		let t = 0;
		let fail = false;
		const get = createVectorSource({
			fetchImpl: (async () =>
				fail
					? new Response("no", { status: 500 })
					: ok()) as unknown as typeof fetch,
			now: () => t,
		});
		expect(await get()).not.toBeNull();
		fail = true;
		t = 700_000;
		expect(await get()).not.toBeNull();

		const never = createVectorSource({
			fetchImpl: (async () => {
				throw new Error("offline");
			}) as unknown as typeof fetch,
		});
		expect(await never()).toBeNull();
	});

	test("a malformed file is rejected", async () => {
		const get = createVectorSource({
			fetchImpl: (async () =>
				Response.json({ model: 1 })) as unknown as typeof fetch,
		});
		expect(await get()).toBeNull();
	});

	test("reads the file from DOCS_VECTORS_URL, never from the request", async () => {
		const prior = process.env.DOCS_VECTORS_URL;
		process.env.DOCS_VECTORS_URL = "http://vectors.test/v.json";
		let seen = "";
		try {
			await createVectorSource({
				fetchImpl: (async (url: string) => {
					seen = url;
					return ok();
				}) as unknown as typeof fetch,
			})();
		} finally {
			if (prior === undefined) {
				Reflect.deleteProperty(process.env, "DOCS_VECTORS_URL");
			} else process.env.DOCS_VECTORS_URL = prior;
		}
		expect(seen).toBe("http://vectors.test/v.json");
	});
});
