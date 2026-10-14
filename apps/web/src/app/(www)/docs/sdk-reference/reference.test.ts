import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stripAnnotations } from "@/lib/code/annotations";
import { docsNavPages } from "../nav";
import { errorTreeHtml, mapBoxHtml, paramGroupsHtml } from "./html";
import { resolveLegacy } from "./legacy";
import { sdkPageMarkdown } from "./markdown";
import { paragraphs, parseInline } from "./markdown-text";
import { SDK_BASE, SDK_SURFACES, sdkPages } from "./pages";
import {
	OPTIONS_SHOWN,
	callbackArgs,
	constructorEntry,
	errorTree,
	exampleWithRefs,
	fieldsOfType,
	formatType,
	groupParams,
	legacyOwners,
	manifest,
	methodAnchor,
	paramRows,
	restTarget,
	signatureOf,
	splitTop,
	surface,
	typeAnchor,
	typeMap,
} from "./reference";

const m = manifest();

describe("anchors", () => {
	test("every method and type anchor is the one its symbol links to", () => {
		for (const s of m.surfaces) {
			const data = surface(s.slug);
			for (const method of data.methods) {
				expect(m.symbols[method.path], method.path).toBe(
					`${SDK_BASE}/${s.slug}#${methodAnchor(method.id)}`,
				);
			}
			for (const type of data.types) {
				const home = m.symbols[type.name] as string;
				// A type listed on two pages links to the first; its own anchor is the same.
				expect(home.endsWith(`#${typeAnchor(type.name)}`), type.name).toBe(
					true,
				);
			}
		}
	});

	test("anchors are unique on a surface", () => {
		for (const s of m.surfaces) {
			const data = surface(s.slug);
			const ids = [
				...data.methods.map((x) => methodAnchor(x.id)),
				...data.types.map((x) => typeAnchor(x.name)),
			];
			expect(ids.length).toBe(new Set(ids).size);
		}
	});
});

describe("the page set", () => {
	test("every extracted surface has a page, a blurb and a route", () => {
		expect(SDK_SURFACES.map((s) => s.slug).sort()).toEqual(
			m.surfaces.map((s) => s.slug).sort(),
		);
		for (const s of SDK_SURFACES) {
			expect(s.blurb.length, s.slug).toBeGreaterThan(0);
			expect(
				existsSync(join(import.meta.dir, s.slug, "page.mdx")),
				s.slug,
			).toBe(true);
		}
		for (const slug of ["helpers", "errors"])
			expect(existsSync(join(import.meta.dir, slug, "page.mdx"))).toBe(true);
	});

	test("the sidebar lists the overview, every surface, helpers and errors, in order", () => {
		const hrefs = docsNavPages()
			.filter((p) => p.group === "SDK reference")
			.map((p) => p.href);
		expect(hrefs).toEqual(sdkPages().map((p) => p.href));
		expect(hrefs[0]).toBe(SDK_BASE);
	});

	test("the index surface lives at /docs/sdk-reference/index", () => {
		expect(m.surfaces.some((s) => s.slug === "index")).toBe(true);
		expect(m.symbols["sl.index.events.list"]).toBe(
			"/docs/sdk-reference/index#m-events-list",
		);
	});
});

describe("doc comments are inline markup only", () => {
	test("no description holds a fenced block, list or html tag the renderer would drop", () => {
		const texts: string[] = [];
		for (const s of m.surfaces) {
			const data = surface(s.slug);
			for (const method of data.methods) {
				texts.push(method.description);
				for (const o of method.overloads) {
					texts.push(o.description, o.returns.description);
					for (const p of o.params) texts.push(p.description);
				}
			}
			for (const t of data.types) {
				texts.push(t.summary);
				for (const f of t.fields ?? []) texts.push(f.description);
			}
		}
		for (const text of texts) {
			expect(text).not.toContain("```");
			expect(text).not.toMatch(/^\s*[-*]\s/m);
			expect(text.replace(/`[^`]*`/g, "")).not.toMatch(/<\/?[a-z][^>]*>/);
		}
	});

	test("inline code and links parse, paragraphs split", () => {
		expect(parseInline("Use [`X`](/docs/a#b) or `y`.")).toEqual([
			{ kind: "text", text: "Use " },
			{
				kind: "link",
				label: [{ kind: "code", text: "X" }],
				href: "/docs/a#b",
			},
			{ kind: "text", text: " or " },
			{ kind: "code", text: "y" },
			{ kind: "text", text: "." },
		]);
		expect(paragraphs("a\nb\n\nc")).toEqual(["a b", "c"]);
	});
});

describe("types as text", () => {
	test("splitTop ignores separators inside brackets, generics, arrows and strings", () => {
		expect(splitTop("A<B, C> & { a: 1; b: 2 } & (x: Y) => Z", "&")).toEqual([
			"A<B, C>",
			"{ a: 1; b: 2 }",
			"(x: Y) => Z",
		]);
		expect(splitTop('"a|b" | C<D | E>', "|")).toEqual(['"a|b"', "C<D | E>"]);
	});

	test("a type that fits stays on one line; a long one breaks at its arms and members", () => {
		expect(formatType("A & { b?: string }")).toBe("A & { b?: string }");
		const long = `Common<T> & { ${"field?: string; ".repeat(8)}last: number }`;
		const out = formatType(long, 2);
		expect(out.split("\n").length).toBeGreaterThan(4);
		expect(out).toContain("\n  & {\n    field?: string;");
		// Breaking changes layout only: the tokens are the same.
		expect(out.replace(/[\s;]+/g, "")).toBe(long.replace(/[\s;]+/g, ""));
	});

	test("fieldsOfType opens named types and inline objects, refining by later arms", () => {
		const types = typeMap(surface("streams"));
		const fields = fieldsOfType(
			"StreamsConsumeCommon & { cursor?: number; extra: boolean }",
			types,
		);
		expect(fields?.map((f) => f.name)).toEqual([
			"cursor",
			"batchSize",
			"intervalMs",
			"signal",
			"extra",
		]);
		// The later arm's type wins; the earlier arm's description is kept.
		expect(fields?.find((f) => f.name === "cursor")?.type).toBe("number");
		expect(fields?.find((f) => f.name === "cursor")?.description).toContain(
			"Resume strictly after",
		);
		expect(fieldsOfType("string", types)).toBeNull();
		expect(fieldsOfType("A | B", types)).toBeNull();
	});
});

describe("method entries", () => {
	const streams = surface("streams");
	const types = typeMap(streams);
	const consume = streams.methods.find((x) => x.id === "events.consume");

	test("a signature names its path and parameters and carries refs that never leak", () => {
		if (!consume) throw new Error("events.consume missing");
		const code = signatureOf(consume, consume.overloads[0], new Set(["sink"]));
		expect(code).toContain("// !ref");
		const plain = stripAnnotations(code, "ts");
		expect(plain.startsWith("sl.streams.events.consume(")).toBe(true);
		expect(plain).toContain("params: StreamsEventsConsumeParams");
		expect(plain).toContain("): Promise<StreamsEventsConsumeResult>");
	});

	test("parameter rows open the params type and say which variant owns a field", () => {
		if (!consume) throw new Error("events.consume missing");
		const rows = paramRows(consume, types);
		const names = rows.map((r) => r.name);
		for (const name of ["onBatch", "onReorg", "sink", "fromCursor", "types"])
			expect(names, name).toContain(name);
		expect(rows.find((r) => r.name === "decoded")?.only).toBe("Stacks");
		expect(rows.find((r) => r.name === "rune")?.only).toBe("Bitcoin");
		expect(rows.find((r) => r.name === "signal")?.only).toBeUndefined();
	});

	test("a method with several parameters prefixes opened fields with the parameter's name", () => {
		const byTx = streams.methods.find((x) => x.id === "events.byTxId");
		if (!byTx) throw new Error("events.byTxId missing");
		expect(paramRows(byTx, types).map((r) => r.name)).toEqual([
			"txId",
			"opts.chain",
		]);
	});

	test("options past the shown count fold; few options do not", () => {
		const row = (name: string, required = false) => ({
			name,
			type: "string",
			required,
			description: "",
		});
		const few = groupParams([row("a", true), row("b"), row("c")]);
		expect(few.map((g) => g.title)).toEqual(["Required", "Options"]);
		expect(few[1]?.folded).toEqual([]);
		const many = groupParams(
			Array.from({ length: OPTIONS_SHOWN + 5 }, (_, i) => row(`o${i}`)),
		);
		expect(many[0]?.shown).toHaveLength(OPTIONS_SHOWN);
		expect(many[0]?.folded).toHaveLength(5);
	});

	test("callback context is the ctx argument's type, once, never a deprecated alias", () => {
		if (!consume) throw new Error("events.consume missing");
		const found = callbackArgs(paramRows(consume, types), types).map((c) =>
			c.type.replace(/<.*$/, ""),
		);
		expect(found).toContain("ConsumerBatchContext");
		expect(new Set(found).size).toBe(found.length);
		expect(found).not.toContain("StreamsBatchContext");
	});

	test("parameter tables escape what a type or description holds", () => {
		const html = paramGroupsHtml([
			{
				title: "Options",
				shown: [
					{
						name: "x",
						type: "Array<A | B>",
						required: false,
						description: "Use `<b>` here.",
					},
				],
				folded: [],
			},
		]);
		expect(html).toContain("Array&lt;A | B&gt;");
		expect(html).toContain("<code>&lt;b&gt;</code>");
		expect(html).toContain('class="mention sdkr-prow" data-hover="x"');
	});

	test("an error's summary and a box's blurb render their code spans, a box drops links", () => {
		const tree = errorTreeHtml(
			[
				{ prefix: "", name: "Root", note: "", summary: "" },
				{
					prefix: "└─ ",
					name: "ApiError",
					note: "",
					summary: "Thrown by `SecondLayer` when a [request](/x) fails.",
				},
			],
			(n) => `/e#${n}`,
		);
		expect(tree).toContain("<code>SecondLayer</code>");
		expect(tree).not.toContain("`");
		expect(tree).toContain('<a href="/e#ApiError"><b>ApiError</b></a>');
		const box = mapBoxHtml(
			"/h",
			"retry",
			"Parse a `Retry-After` [header](/y).",
		);
		expect(box).toContain("<code>Retry-After</code>");
		expect(box.match(/<a /g)).toHaveLength(1);
	});

	test("a void or undefined return reaches the glance table as written", () => {
		const m1 = surface("streams").methods.flatMap((x) => x.overloads);
		expect(JSON.stringify(m1)).not.toContain("=> null");
	});
});

describe("examples", () => {
	test("an example may call out and mark; anything that changes what it shows fails the build", () => {
		const ok = "// !callout[/x/] why\nconst x = 1;";
		expect(exampleWithRefs(ok, new Set())).toContain("!callout");
		for (const verb of ["focus", "diff", "collapse", "error", "pick", "ref"])
			expect(() =>
				exampleWithRefs(`// !${verb} x\nconst x = 1;`, new Set(), "e.ts"),
			).toThrow(/e\.ts/);
	});

	test("the docs budget holds here too: at most 3 callouts and 2 marks", () => {
		const lines = (verb: string, n: number) =>
			Array.from(
				{ length: n },
				(_, i) => `// !${verb}[/x${i}/] note\nx${i};`,
			).join("\n");
		expect(() => exampleWithRefs(lines("callout", 3), new Set())).not.toThrow();
		expect(() =>
			exampleWithRefs(lines("callout", 4), new Set(), "e.ts"),
		).toThrow(/4 !callout.*budget is 3/);
		expect(() => exampleWithRefs(lines("mark", 3), new Set())).toThrow(
			/budget is 2/,
		);
	});

	test("every example file in the SDK package passes", () => {
		for (const s of m.surfaces)
			for (const method of surface(s.slug).methods)
				for (const ex of method.examples)
					expect(() =>
						exampleWithRefs(ex.code, new Set(), ex.file),
					).not.toThrow();
	});

	test("a key the params name gets a ref; a property access of the same name does not", () => {
		const out = exampleWithRefs(
			"await sl.go({\n  types: [1],\n});\nconst a = x.types;",
			new Set(["types"]),
		);
		expect(out.match(/!ref/g)).toHaveLength(1);
	});
});

describe("REST twins", () => {
	test("a trailing template hole that is not a path segment drops away", () => {
		expect(restTarget("GET /v1/subgraphs/{name}/{table}{cursorQs}")).toEqual({
			method: "GET",
			path: "/v1/subgraphs/{name}/{table}",
		});
		expect(restTarget("GET /api/subgraphs/{name}/docs.md{options}").path).toBe(
			"/api/subgraphs/{name}/docs.md",
		);
		expect(restTarget("DELETE /api/webhooks/{id}").path).toBe(
			"/api/webhooks/{id}",
		);
	});
});

describe("errors", () => {
	test("the tree roots at the base class and lists every class once", () => {
		const lines = errorTree(m.errors);
		expect(lines[0]).toMatchObject({ name: "SecondLayerError", prefix: "" });
		expect(lines.length).toBe(m.errors.length + 1);
		expect(lines.find((l) => l.name === "AuthError")?.note).toBe("401");
	});
});

describe("old anchors", () => {
	const owners = legacyOwners();

	test("an export's old x- anchor resolves to its new page and anchor", () => {
		expect(resolveLegacy(owners, "#x-consumerbatchcontext")).toBe(
			"/docs/sdk-reference/streams#t-ConsumerBatchContext",
		);
		expect(resolveLegacy(owners, "#x-verifywebhooksignature")).toBe(
			"/docs/sdk-reference/helpers#h-verifyWebhookSignature",
		);
		expect(resolveLegacy(owners, "#x-autherror")).toBe(
			"/docs/sdk-reference/errors#e-AuthError",
		);
	});

	test("an old area anchor resolves to the surface page that replaced it", () => {
		expect(resolveLegacy(owners, "#subscriptions-and-webhooks")).toBe(
			"/docs/sdk-reference/webhooks",
		);
		expect(resolveLegacy(owners, "#streams")).toBe(
			"/docs/sdk-reference/streams",
		);
		expect(resolveLegacy(owners, "#proofs")).toBe(
			"/docs/sdk-reference/helpers",
		);
	});

	test("an unknown or malformed hash stays where it is", () => {
		expect(resolveLegacy(owners, "#nothing")).toBeNull();
		expect(resolveLegacy(owners, "")).toBeNull();
		expect(resolveLegacy(owners, "#%E0%A4%A")).toBeNull();
		expect(resolveLegacy(owners, "#constructor")).toBeNull();
	});
});

describe("constructor", () => {
	test("the client surface has one, and only it: other surfaces inherit nothing", () => {
		const ctor = constructorEntry(surface("client"));
		expect(ctor?.path).toBe("new SecondLayer");
		const rows = paramRows(ctor as NonNullable<typeof ctor>, new Map());
		expect(rows.map((r) => r.name)).toContain("baseUrl");
		expect(rows.find((r) => r.name === "baseUrl")?.description).toContain(
			"Base URL",
		);
		for (const slug of ["streams", "index", "webhooks"])
			expect(constructorEntry(surface(slug))).toBeNull();
	});

	test("its signature is the call with an options object and no return type", () => {
		const ctor = constructorEntry(surface("client"));
		if (!ctor) throw new Error("no constructor");
		const code = stripAnnotations(
			signatureOf(
				ctor,
				ctor.overloads[0] as NonNullable<(typeof ctor.overloads)[0]>,
				new Set(),
			),
			"ts",
		);
		expect(code.startsWith("new SecondLayer(")).toBe(true);
		expect(code.trimEnd().endsWith(")")).toBe(true);
		expect(code).toContain("baseUrl?: string;");
	});

	test("the markdown twin lists it first", () => {
		const md = sdkPageMarkdown("/docs/sdk-reference/client") ?? "";
		expect(md.indexOf("### new SecondLayer(options)")).toBeGreaterThan(-1);
		expect(md.indexOf("### new SecondLayer(options)")).toBeLessThan(
			md.indexOf("### sl.batch"),
		);
	});
});

describe("markdown twins", () => {
	test("a surface lists each method as a ### entry with a parameter table", () => {
		const md = sdkPageMarkdown("/docs/sdk-reference/streams") ?? "";
		expect(md).toContain("## Methods");
		expect(md).toContain("### sl.streams.events.consume(params)");
		expect(md).toContain("| Name | Type | Required | Description |");
		expect(md).toContain("## Types");
		expect(md).not.toContain("!ref");
		expect(md).not.toContain("!callout");
	});

	test("overview, helpers and errors have bodies; other hrefs have none", () => {
		for (const href of [
			SDK_BASE,
			`${SDK_BASE}/helpers`,
			`${SDK_BASE}/errors`,
			`${SDK_BASE}/client`,
		])
			expect(sdkPageMarkdown(href), href).toBeTruthy();
		expect(sdkPageMarkdown("/docs/streams")).toBeNull();
		expect(sdkPageMarkdown(`${SDK_BASE}/nope`)).toBeNull();
	});
});
