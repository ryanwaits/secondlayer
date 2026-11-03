import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import docsNewPages from "@/generated/docs-new.json";
import { parseDocsDiff, rowsAsOf, stagedChanges } from "../../scripts/docs-new";
import { headingTerms, newRows } from "./docs-new-rule.mjs";
import { isFresh } from "./docs-new.mjs";

const TODAY = "2026-10-15";

describe("isFresh", () => {
	const now = Date.parse(TODAY);
	test("a mark shows for 30 days from its date, then drops off", () => {
		expect(isFresh("2026-10-15", now)).toBe(true);
		expect(isFresh("2026-09-16", now)).toBe(true);
		expect(isFresh("2026-09-15", now)).toBe(false);
	});
	test("no mark, a bad date or a future date shows nothing", () => {
		expect(isFresh(undefined, now)).toBe(false);
		expect(isFresh("soon", now)).toBe(false);
		expect(isFresh("2026-10-16", now)).toBe(false);
	});
});

type Feat = { date: string; scope: string; subject: string };

const AS_OF = "2026-11-02";

/** `count` feat subjects naming `phrase`, one per scope in turn, on `date`. */
const feats = (
	phrase: string,
	scopes: string[],
	count: number,
	date = "2026-10-20",
): Feat[] =>
	Array.from({ length: count }, (_, i) => ({
		date,
		scope: scopes[i % scopes.length],
		subject: `${phrase} number ${i}`,
	}));

const FOUR_SCOPES = ["docker", "workload", "subgraphs", "api"];

/** Rows for one heading on `route` added at `date`, with `extra` feat history. */
function launchRows(
	text: string,
	history: Feat[],
	{ route = "/docs/webhooks", date = AS_OF } = {},
) {
	return newRows(
		{
			feats: history,
			headings: [{ date, route, text }],
			pages: [],
			exists: () => true,
			mentions: () => 1,
		},
		AS_OF,
	);
}

describe("launch headings", () => {
	test("a term shipped code suddenly names launches its heading's page", () => {
		const history = [
			{
				date: "2026-02-10",
				scope: "docker",
				subject: "testnet compose profile",
			},
			...feats("testnet", FOUR_SCOPES, 5),
		];
		expect(launchRows("Testnet", history)).toEqual({
			"/docs/webhooks": AS_OF,
		});
	});

	test("a word in old feature history doesn't launch", () => {
		const history = [
			...feats("pin a version", FOUR_SCOPES, 3, "2026-06-01"),
			...feats("pin", FOUR_SCOPES, 5),
		];
		expect(launchRows("Pin a version", history)).toEqual({});
	});

	test("too few subjects don't launch", () => {
		expect(launchRows("Rotate a key", feats("rotate", FOUR_SCOPES, 4))).toEqual(
			{},
		);
		expect(launchRows("Rotate a key", feats("rotate", FOUR_SCOPES, 5))).toEqual(
			{ "/docs/webhooks": AS_OF },
		);
	});

	test("web-only subjects don't launch", () => {
		const history = feats("gizmo", ["web"], 6);
		expect(launchRows("Gizmo", history)).toEqual({});
	});

	test("stop words never launch", () => {
		const common = [
			...feats("how it works", FOUR_SCOPES, 6),
			...feats("more on each one", FOUR_SCOPES, 6),
		];
		expect(launchRows("How rows are counted", common)).toEqual({});
		expect(launchRows("More on each path", common)).toEqual({});
	});

	test("a refactor heading with no feature history doesn't launch", () => {
		expect(launchRows("Hardware", [])).toEqual({});
	});

	test("a heading older than 30 days has expired", () => {
		const history = feats("testnet", FOUR_SCOPES, 5, "2026-09-25");
		const rows = newRows(
			{
				feats: history,
				headings: [
					{ date: "2026-09-30", route: "/docs/webhooks", text: "Testnet" },
				],
				pages: [],
				exists: () => true,
				mentions: () => 1,
			},
			"2026-11-02",
		);
		expect(rows).toEqual({});
	});

	test("one launch, one row: the page mentioning the term most, with the newest date", () => {
		const hits = [
			{ date: "2026-10-12", route: "/docs/index", text: "Runes" },
			{ date: "2026-10-15", route: "/docs/streams", text: "Runes" },
			{ date: "2026-10-20", route: "/docs/self-host", text: "Runes" },
		];
		const counts: Record<string, number> = {
			"/docs/index": 9,
			"/docs/streams": 2,
			"/docs/self-host": 3,
		};
		const rows = newRows(
			{
				feats: feats("runes", FOUR_SCOPES, 5, "2026-10-10"),
				headings: hits,
				pages: [],
				exists: () => true,
				mentions: (route) => counts[route],
			},
			AS_OF,
		);
		expect(rows).toEqual({ "/docs/index": "2026-10-20" });
	});

	test("a page that no longer exists gets no row", () => {
		const rows = newRows(
			{
				feats: feats("testnet", FOUR_SCOPES, 5),
				headings: [{ date: AS_OF, route: "/docs/gone", text: "Testnet" }],
				pages: [],
				exists: () => false,
				mentions: () => 0,
			},
			AS_OF,
		);
		expect(rows).toEqual({});
	});

	test("headings on the changelog never count", () => {
		const history = feats("testnet", FOUR_SCOPES, 5);
		expect(
			launchRows("Testnet", history, { route: "/docs/changelog" }),
		).toEqual({});
	});

	test("a launch row expires 31 days later", () => {
		const history = feats("testnet", FOUR_SCOPES, 5);
		const make = (asOf: string) =>
			newRows(
				{
					feats: history,
					headings: [{ date: AS_OF, route: "/docs/webhooks", text: "Testnet" }],
					pages: [],
					exists: () => true,
					mentions: () => 1,
				},
				asOf,
			);
		expect(make("2026-12-02")).toEqual({ "/docs/webhooks": AS_OF });
		expect(make("2026-12-03")).toEqual({});
	});
});

describe("headingTerms", () => {
	test("stems words and drops stop words and short words", () => {
		expect(headingTerms("Runes and the Webhooks")).toEqual(["rune"]);
		expect(headingTerms("How rows are counted")).toEqual(["row", "counted"]);
	});
});

describe("new pages", () => {
	const page = (route: string, at: number, extra = {}) => ({
		date: "2026-10-28",
		at,
		route,
		lines: 80,
		moved: 0,
		...extra,
	});
	const rowsFor = (
		pages: ReturnType<typeof page>[],
		exists: (route: string) => boolean = () => true,
	) =>
		newRows(
			{ feats: [], headings: [], pages, exists, mentions: () => 0 },
			AS_OF,
		);

	test("a group keeps its newest two pages", () => {
		expect(
			rowsFor([
				page("/docs/guides/a", 1),
				page("/docs/guides/b", 3),
				page("/docs/guides/c", 2),
			]),
		).toEqual({
			"/docs/guides/b": "2026-10-28",
			"/docs/guides/c": "2026-10-28",
		});
	});

	test("groups are counted separately, top-level pages share one", () => {
		const rows = rowsFor([
			page("/docs/guides/a", 1),
			page("/docs/recipes/a", 1),
			page("/docs/one", 1),
		]);
		expect(Object.keys(rows)).toEqual([
			"/docs/guides/a",
			"/docs/one",
			"/docs/recipes/a",
		]);
	});

	test("a stub, a moved page and a removed page are out", () => {
		expect(
			rowsFor(
				[
					page("/docs/guides/stub", 1, { lines: 15 }),
					page("/docs/guides/moved", 2, { moved: 0.6 }),
					page("/docs/guides/gone", 3),
					page("/docs/guides/real", 4),
				],
				(route) => route !== "/docs/guides/gone",
			),
		).toEqual({ "/docs/guides/real": "2026-10-28" });
	});

	test("a page added over 30 days ago is out", () => {
		expect(
			rowsFor([page("/docs/guides/old", 1, { date: "2026-09-30" })]),
		).toEqual({});
	});

	test("the changelog never counts", () => {
		expect(rowsFor([page("/docs/changelog", 1)])).toEqual({});
	});

	test("a launch row wins over a new-page row for the same route", () => {
		const rows = newRows(
			{
				feats: feats("testnet", FOUR_SCOPES, 5),
				headings: [{ date: AS_OF, route: "/docs/guides/a", text: "Testnet" }],
				pages: [page("/docs/guides/a", 1)],
				exists: () => true,
				mentions: () => 1,
			},
			AS_OF,
		);
		expect(rows).toEqual({ "/docs/guides/a": AS_OF });
	});
});

describe("staged docs changes", () => {
	const PAGE = "apps/web/src/app/(www)/docs/guides/zz-test/page.mdx";
	const created = (lines: string[], path = PAGE) =>
		[
			`diff --git a/${path} b/${path}`,
			"new file mode 100644",
			"index 0000000..1111111",
			"--- /dev/null",
			`+++ b/${path}`,
			`@@ -0,0 +1,${lines.length} @@`,
			...lines.map((line) => `+${line}`),
			"",
		].join("\n");
	const body = (count: number) =>
		Array.from({ length: count }, (_, i) => `A distinct line of copy ${i}.`);

	test("a staged new 60-line guide is a page dated today", () => {
		const change = stagedChanges(created(body(60)), AS_OF, 1_000);
		expect(change.pages).toEqual([
			{
				path: PAGE,
				date: AS_OF,
				at: 1_000,
				route: "/docs/guides/zz-test",
				lines: 60,
				moved: 0,
			},
		]);
		const rows = newRows(
			{
				feats: [],
				headings: [],
				pages: change.pages,
				exists: () => true,
				mentions: () => 0,
			},
			AS_OF,
		);
		expect(rows).toEqual({ "/docs/guides/zz-test": AS_OF });
	});

	test("a staged new ### heading is a heading dated today and launches", () => {
		const diff = [
			"diff --git a/apps/web/src/app/(www)/docs/webhooks/page.mdx b/apps/web/src/app/(www)/docs/webhooks/page.mdx",
			"index 1111111..2222222 100644",
			"--- a/apps/web/src/app/(www)/docs/webhooks/page.mdx",
			"+++ b/apps/web/src/app/(www)/docs/webhooks/page.mdx",
			"@@ -10,0 +11,3 @@",
			"+### Testnet",
			"+",
			"+Try it free.",
			"",
		].join("\n");
		const change = stagedChanges(diff, AS_OF, 1_000);
		expect(change.headings).toEqual([
			{ date: AS_OF, route: "/docs/webhooks", text: "Testnet" },
		]);
		expect(change.pages).toEqual([]);
		const rows = newRows(
			{
				feats: feats("testnet", FOUR_SCOPES, 5),
				headings: change.headings,
				pages: [],
				exists: () => true,
				mentions: () => 1,
			},
			AS_OF,
		);
		expect(rows).toEqual({ "/docs/webhooks": AS_OF });
	});

	test("a 15-line staged stub doesn't count", () => {
		const change = stagedChanges(created(body(15)), AS_OF, 1_000);
		const rows = newRows(
			{
				feats: [],
				headings: [],
				pages: change.pages,
				exists: () => true,
				mentions: () => 0,
			},
			AS_OF,
		);
		expect(rows).toEqual({});
	});

	test("lines removed from another page in the same diff count as moved", () => {
		const old = "apps/web/src/app/(www)/docs/old/page.mdx";
		const lines = body(60);
		const diff = `${created(lines)}${[
			`diff --git a/${old} b/${old}`,
			"deleted file mode 100644",
			`--- a/${old}`,
			"+++ /dev/null",
			`@@ -1,${lines.length} +0,0 @@`,
			...lines.map((line) => `-${line}`),
			"",
		].join("\n")}`;
		const { files, removed } = parseDocsDiff(diff);
		expect(files.map((f) => f.route)).toEqual(["/docs/guides/zz-test"]);
		expect(removed.size).toBe(60);
		expect(stagedChanges(diff, AS_OF, 1).pages[0].moved).toBe(1);
	});
});

// A hook's GIT_DIR would point git at the wrong repo.
const env = { ...process.env };
for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
	delete env[key];
}
const shallow =
	execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
		encoding: "utf8",
		cwd: import.meta.dir,
		env,
	}).trim() === "true";

// CI checks out with depth 1, so there is no history to read there.
test.skipIf(shallow)(
	"the real history picks testnet, Runes and the two newest guides on 2026-11-02",
	() => {
		// History is immutable and every input is read as of that date, so later
		// docs edits can't break this.
		expect(rowsAsOf("2026-11-02")).toEqual({
			"/docs/guides/handle-reorgs": "2026-10-31",
			"/docs/guides/index-contract-into-postgres": "2026-10-28",
			"/docs/index": "2026-10-15",
			"/docs/webhooks": "2026-11-02",
		});
	},
);

test("every route in docs-new.json has a docs page", () => {
	const docs = join(import.meta.dir, "..", "app", "(www)", "docs");
	const pages: Record<string, string> = docsNewPages;
	for (const route of Object.keys(pages)) {
		expect(
			existsSync(join(docs, route.replace(/^\/docs\/?/, ""), "page.mdx")),
		).toBe(true);
	}
});
