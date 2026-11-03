import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import docsNewPages from "@/generated/docs-new.json";
import { rowsAsOf } from "../../scripts/docs-new";
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
