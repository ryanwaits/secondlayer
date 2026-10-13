import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { logger } from "@secondlayer/shared";
import { Hono } from "hono";
import {
	InProcRateLimitStore,
	_resetRateLimitStoreForTests,
} from "../auth/rate-limit-store.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	type SectionList,
	buildCatalog,
	createDocsFindRouter,
	createSectionSource,
	pageQuestionId,
} from "./public-docs-find.ts";

afterEach(async () => {
	await _resetRateLimitStoreForTests();
});

const LIST: SectionList = {
	pages: [
		{ href: "/docs", title: "Overview", lede: "What Secondlayer is." },
		{ href: "/docs/streams", title: "Streams", lede: "Every event, in order." },
		{ href: "/docs/self-host/production", title: "Production", lede: "" },
		{ href: "/docs/empty", title: "Empty", lede: "No sections." },
	],
	sections: [
		{
			href: "/docs/streams",
			anchor: "reorgs",
			title: "Reorgs",
			summary: "Rows roll back after a fork.",
		},
		{
			href: "/docs/streams",
			anchor: "cursors",
			title: "Cursors",
			summary: "Resume where you stopped.",
		},
		{
			href: "/docs/self-host/production",
			anchor: "backups",
			title: "Backups",
			summary: "",
		},
	],
};

type Answers = Record<
	string,
	{ type: string; choice?: string; confidence?: number }
>;

function router(opts: {
	answers?: Answers | null;
	list?: SectionList | null;
	onClassify?: (state: string) => void;
}) {
	const catalog = opts.list === null ? null : buildCatalog(opts.list ?? LIST);
	const app = new Hono();
	app.onError(errorHandler);
	app.route(
		"/api/public/docs-find",
		createDocsFindRouter({
			rateLimitStore: new InProcRateLimitStore(),
			catalog: async () => catalog,
			classify: async ({ state }) => {
				opts.onClassify?.(state);
				return opts.answers ? { answers: opts.answers } : null;
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

const HIT: Answers = {
	page: { type: "choice", choice: "streams", confidence: 0.95 },
	"s.streams": { type: "choice", choice: "reorgs", confidence: 0.9 },
};

describe("buildCatalog", () => {
	test("maps page hrefs to question ids that satisfy the classifier id rule", () => {
		expect(pageQuestionId("/docs")).toBe("docs");
		expect(pageQuestionId("/docs/streams")).toBe("streams");
		expect(pageQuestionId("/docs/self-host/production")).toBe(
			"self-host.production",
		);
	});

	test("asks for a section only on pages that have sections, and offers none and whole-page escapes", () => {
		const { questions } = buildCatalog(LIST);
		expect(Object.keys(questions).sort()).toEqual([
			"page",
			"s.self-host.production",
			"s.streams",
		]);
		expect(Object.keys(questions.page.criteria)).toContain("none");
		expect(Object.keys(questions["s.streams"].criteria)).toContain("_page");
	});

	test("an anchor named page never collides with the whole-page option", () => {
		const { questions } = buildCatalog({
			pages: [{ href: "/docs/a", title: "A", lede: "" }],
			sections: [
				{ href: "/docs/a", anchor: "page", title: "Page", summary: "" },
			],
		});
		expect(Object.keys(questions["s.a"].criteria).sort()).toEqual([
			"_page",
			"page",
		]);
	});

	test("keeps the first 254 sections of an oversized page instead of throwing", () => {
		const sections = Array.from({ length: 300 }, (_, i) => ({
			href: "/docs/big",
			anchor: `s${i}`,
			title: `S${i}`,
			summary: "",
		}));
		const { questions } = buildCatalog({
			pages: [{ href: "/docs/big", title: "Big", lede: "" }],
			sections,
		});
		// 254 sections + the whole-page escape = the classifier's 255-option cap.
		expect(Object.keys(questions["s.big"].criteria)).toHaveLength(255);
	});
});

describe("POST /api/public/docs-find", () => {
	test("refuses a missing, short, long or non-string q", async () => {
		const app = router({ answers: HIT });
		for (const body of [{}, { q: "ab" }, { q: "x".repeat(201) }, { q: 42 }]) {
			expect((await post(app, body)).status).toBe(400);
		}
		expect((await post(app, "{not json")).status).toBe(400);
	});

	test("maps a confident page and section answer to that section", async () => {
		const res = await post(router({ answers: HIT }), {
			q: "why are my rows doubled after a fork",
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			match: {
				href: "/docs/streams",
				anchor: "reorgs",
				title: "Reorgs",
				confidence: 0.9,
			},
		});
	});

	test("confidence is the weaker of the page and section answers", async () => {
		const res = await post(
			router({
				answers: {
					page: { type: "choice", choice: "streams", confidence: 0.6 },
					"s.streams": { type: "choice", choice: "cursors", confidence: 0.99 },
				},
			}),
			{ q: "resume where my consumer stopped" },
		);
		const { match } = (await res.json()) as {
			match: { anchor: string; confidence: number };
		};
		expect(match.anchor).toBe("cursors");
		expect(match.confidence).toBe(0.6);
	});

	test("the whole-page option, or a page without sections, matches the page alone", async () => {
		const whole = await post(
			router({
				answers: {
					page: { type: "choice", choice: "streams", confidence: 0.9 },
					"s.streams": { type: "choice", choice: "_page", confidence: 0.9 },
				},
			}),
			{ q: "what is streams" },
		);
		expect(await whole.json()).toEqual({
			match: { href: "/docs/streams", title: "Streams", confidence: 0.9 },
		});
		const bare = await post(
			router({
				answers: { page: { type: "choice", choice: "empty", confidence: 0.8 } },
			}),
			{ q: "the empty page" },
		);
		expect(await bare.json()).toEqual({
			match: { href: "/docs/empty", title: "Empty", confidence: 0.8 },
		});
	});

	test("none and refusal answer no match", async () => {
		for (const page of [
			{ type: "choice", choice: "none", confidence: 0.9 },
			{ type: "refusal" },
		]) {
			const res = await post(router({ answers: { page } }), {
				q: "best pizza near me",
			});
			expect(await res.json()).toEqual({ match: null });
		}
	});

	test("a failed classifier or missing section list answers no match with 200", async () => {
		const failed = await post(router({ answers: null }), { q: "any question" });
		expect(failed.status).toBe(200);
		expect(await failed.json()).toEqual({ match: null });
		const noList = await post(router({ answers: HIT, list: null }), {
			q: "any question",
		});
		expect(noList.status).toBe(200);
		expect(await noList.json()).toEqual({ match: null });
	});

	test("repeats of a query, any case or spacing, are answered without a second model call", async () => {
		let calls = 0;
		const app = router({ answers: HIT, onClassify: () => calls++ });
		await post(app, { q: "Why are rows doubled" });
		await post(app, { q: "  why   ARE rows   doubled " });
		expect(calls).toBe(1);
	});

	test("a failed call is not cached", async () => {
		let calls = 0;
		const app = router({ answers: null, onClassify: () => calls++ });
		await post(app, { q: "any question" });
		await post(app, { q: "any question" });
		expect(calls).toBe(2);
	});

	test("refuses the 31st search in a minute from one address with 429", async () => {
		const app = router({ answers: HIT });
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
			{
				"x-forwarded-for": "203.0.113.10",
			},
		);
		expect(other.status).toBe(200);
	});

	test("requests with no trusted address share one bucket", async () => {
		const app = router({ answers: HIT });
		for (let i = 0; i < 30; i++) await post(app, { q: `question ${i}` });
		expect((await post(app, { q: "one more" })).status).toBe(429);
	});

	test("the query never reaches the logger", async () => {
		const spies = (["debug", "info", "warn", "error"] as const).map((level) =>
			spyOn(logger, level).mockImplementation(() => {}),
		);
		try {
			const q = "zq-secret-phrase-7731";
			await post(router({ answers: HIT }), { q });
			await post(router({ answers: null }), { q: `${q} again` });
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

describe("createSectionSource", () => {
	const ok = () => Response.json(LIST);

	test("serves the fetched list for ten minutes, then refetches", async () => {
		let fetches = 0;
		let t = 0;
		const get = createSectionSource({
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

	test("keeps the last good list when a refetch fails, and has none when the first fetch fails", async () => {
		let t = 0;
		let fail = false;
		const get = createSectionSource({
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

		const never = createSectionSource({
			fetchImpl: (async () => {
				throw new Error("offline");
			}) as unknown as typeof fetch,
		});
		expect(await never()).toBeNull();
	});

	test("reads the list from DOCS_SECTIONS_URL, never from the request", async () => {
		const prior = process.env.DOCS_SECTIONS_URL;
		process.env.DOCS_SECTIONS_URL = "http://sections.test/list.json";
		let seen = "";
		try {
			await createSectionSource({
				fetchImpl: (async (url: string) => {
					seen = url;
					return ok();
				}) as unknown as typeof fetch,
			})();
		} finally {
			if (prior === undefined) {
				Reflect.deleteProperty(process.env, "DOCS_SECTIONS_URL");
			} else process.env.DOCS_SECTIONS_URL = prior;
		}
		expect(seen).toBe("http://sections.test/list.json");
	});
});
