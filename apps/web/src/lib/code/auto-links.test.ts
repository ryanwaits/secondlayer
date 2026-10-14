import { describe, expect, test } from "bun:test";
import { autoLinks, buildLinkTable } from "./auto-links";
import { docsRoutes, linkInput } from "./link-table";

const routes = new Set(["/docs/api/streams", "/docs/sdk-reference/streams"]);

const table = buildLinkTable({
	symbols: {
		ConsumerBatchContext: "/docs/sdk-reference/streams#t-ConsumerBatchContext",
		"sl.streams.events.consume": "/docs/sdk-reference/streams#m-events-consume",
		"sl.index.events.list": "/docs/sdk-reference/index-api#m-events-list",
	},
	endpoints: [
		{
			path: "/v1/streams/events",
			href: "/docs/api/streams#list-stream-events",
		},
		{ path: "/v1/streams/{id}", href: "/docs/api/streams#get-stream" },
		{ path: "/v1/streams/tip", href: "/docs/api/streams#get-tip" },
		{ path: "/v1/index/events", href: "/docs/api/index#list-events" },
	],
	routes,
});

const never = () => false;

describe("link table", () => {
	test("a symbol whose page is missing stays plain text", () => {
		expect(table.symbols.has("sl.index.events.list")).toBe(false);
		expect(table.symbols.has("ConsumerBatchContext")).toBe(true);
		const found = autoLinks(
			"await sl.index.events.list();",
			"typescript",
			table,
			new Set(),
			never,
		);
		expect(found).toEqual([]);
	});

	test("an endpoint whose page exists links; one whose page is missing does not", () => {
		const line = 'curl "$URL/v1/streams/events?limit=1"';
		const [link] = autoLinks(line, "bash", table, new Set(), never);
		expect(link?.href).toBe("/docs/api/streams#list-stream-events");
		expect(line.slice(link?.start, link?.end)).toBe("/v1/streams/events");
		expect(
			autoLinks("curl $URL/v1/index/events", "bash", table, new Set(), never),
		).toEqual([]);
	});

	test("the literal template beats the parameterized one", () => {
		const [link] = autoLinks(
			"curl $URL/v1/streams/tip",
			"bash",
			table,
			new Set(),
			never,
		);
		expect(link?.href).toBe("/docs/api/streams#get-tip");
		const [other] = autoLinks(
			"curl $URL/v1/streams/abc",
			"bash",
			table,
			new Set(),
			never,
		);
		expect(other?.href).toBe("/docs/api/streams#get-stream");
	});
});

describe("autoLinks", () => {
	test("a type named twice in a block links once", () => {
		const linked = new Set<string>();
		const first = autoLinks(
			"const a: ConsumerBatchContext = x;",
			"typescript",
			table,
			linked,
			never,
		);
		const second = autoLinks(
			"function f(ctx: ConsumerBatchContext) {}",
			"typescript",
			table,
			linked,
			never,
		);
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(0);
	});

	test("a method path links as a whole", () => {
		const line = "await sl.streams.events.consume({";
		const [link] = autoLinks(line, "typescript", table, new Set(), never);
		expect(line.slice(link?.start, link?.end)).toBe(
			"sl.streams.events.consume",
		);
	});

	test("a span another range holds is skipped, and the name stays free for a later line", () => {
		const linked = new Set<string>();
		const line = "let a: ConsumerBatchContext;";
		expect(autoLinks(line, "typescript", table, linked, () => true)).toEqual(
			[],
		);
		expect(autoLinks(line, "typescript", table, linked, never)).toHaveLength(1);
	});

	test("an identifier that is another object's property is not a type", () => {
		expect(
			autoLinks(
				"x.ConsumerBatchContext",
				"typescript",
				table,
				new Set(),
				never,
			),
		).toEqual([]);
	});

	test("output and other languages never link", () => {
		for (const lang of ["text", "json", "sql"])
			expect(
				autoLinks(
					"ConsumerBatchContext /v1/streams/events",
					lang,
					table,
					new Set(),
					never,
				),
			).toEqual([]);
	});
});

describe("the build's links", () => {
	const input = linkInput();
	const real = buildLinkTable(input);
	const exists = (href: string) => input.routes.has(href.split("#")[0] ?? "");

	test("every emitted link lands on a page that exists", () => {
		for (const href of real.symbols.values())
			expect(exists(href), href).toBe(true);
		for (const e of real.endpoints) expect(exists(e.href), e.href).toBe(true);
	});

	test("every endpoint path gets one link", () => {
		const paths = new Set(input.endpoints.map((e) => e.path));
		expect(real.endpoints).toHaveLength(paths.size);
	});

	test("reference symbols link only where their page exists", () => {
		const live = Object.values(input.symbols).filter(exists).length;
		expect(real.symbols.size).toBe(live);
	});

	test("the route set finds real pages and skips dynamic ones", () => {
		const found = docsRoutes();
		expect(found.has("/docs")).toBe(true);
		expect(found.has("/docs/api/streams")).toBe(true);
		expect([...found].some((r) => r.includes("["))).toBe(false);
	});
});
