import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ReferenceConfig,
	type ReferenceIO,
	type SurfaceFile,
	buildReference,
	linkify,
} from "../../../scripts/reference/build";
import { fileSystemIO } from "../../../scripts/reference/extract";
import { restFor } from "../../../scripts/reference/source";
import type { Spec } from "../../../scripts/reference/walk";

const str = { type: "string" };

const spec: Spec = {
	meta: { name: "@x/pkg", version: "1.0.0" },
	types: [
		{
			name: "StreamsLike",
			kind: "type",
			schema: {
				type: "object",
				properties: {
					events: {
						type: "object",
						properties: {
							list: {
								"x-ts-function": true,
								"x-ts-signatures": [
									{
										parameters: [
											{
												name: "params",
												required: true,
												schema: { $ref: "#/types/BitcoinParams" },
											},
										],
										returns: { schema: { $ref: "#/types/Page" } },
										description: "Runes rows.",
									},
									{
										parameters: [
											{
												name: "params",
												required: false,
												schema: { $ref: "#/types/StacksParams" },
											},
										],
										returns: { schema: { $ref: "#/types/Page" } },
										description: "Stacks rows. See {@link StreamsLike.tip}.",
									},
								],
							},
						},
					},
					tip: {
						"x-ts-function": true,
						"x-ts-signatures": [
							{ returns: { schema: { $ref: "#/types/Tip" } } },
						],
					},
					stream: {
						description:
							'`chain: "bitcoin"` — Runes only; see\n\n{@link \nTip\n}\n.',
						"x-ts-function": true,
						"x-ts-signatures": [
							{
								parameters: [
									{
										name: "p",
										required: true,
										schema: { $ref: "#/types/BitcoinParams" },
									},
								],
								returns: { schema: { $ref: "#/types/Tip" } },
							},
							{
								typeParameters: [
									{ name: "T", constraint: "readonly string[]", const: true },
								],
								parameters: [
									{
										name: "p",
										required: true,
										schema: { $ref: "#/types/StacksParams" },
									},
								],
								returns: { schema: { $ref: "#/types/Tip" } },
							},
						],
					},
					shared: {
						"x-ts-function": true,
						"x-ts-signatures": [
							{
								description:
									"Shared by both overloads, see {@link Tip}. More text.",
								returns: { schema: { type: "string" } },
							},
							{ returns: { schema: { type: "number" } } },
						],
					},
					repeated: {
						description: "One doc, listed per signature.",
						"x-ts-function": true,
						"x-ts-signatures": [
							{
								description: "One doc, listed per signature.",
								returns: { schema: { type: "string" } },
							},
							{ returns: { schema: { type: "number" } } },
							{
								description: "One doc, listed per signature.",
								returns: { schema: { type: "string" } },
							},
							{ returns: { schema: { type: "number" } } },
						],
					},
				},
			},
		},
		{
			name: "BitcoinParams",
			kind: "type",
			schema: {
				type: "object",
				properties: { chain: { ...str, enum: ["bitcoin"] }, rune: str },
				required: ["chain"],
			},
		},
		{
			name: "StacksParams",
			kind: "type",
			schema: {
				type: "object",
				properties: { chain: { ...str, enum: ["stacks"] }, cursor: str },
			},
		},
		{
			name: "Page",
			kind: "type",
			schema: {
				type: "object",
				properties: {
					next: { $ref: "#/types/Tip", description: "Where next." },
				},
			},
		},
		{
			name: "Tip",
			kind: "type",
			schema: { type: "object", properties: { height: { type: "number" } } },
		},
	],
	exports: [
		{
			name: "Client",
			kind: "class",
			source: { file: "src/client.ts", line: 1 },
			members: [
				{
					name: "streams",
					kind: "property",
					schema: { $ref: "#/types/StreamsLike" },
				},
				{
					name: "ping",
					kind: "method",
					description: "Check the connection. Second sentence.",
					schema: { "x-ts-function": true },
					signatures: [{ returns: { schema: { type: "boolean" } } }],
				},
				{
					name: "internal",
					kind: "method",
					visibility: "protected",
					schema: { "x-ts-function": true },
					signatures: [{ returns: { schema: { type: "boolean" } } }],
				},
				{
					name: "_hidden",
					kind: "method",
					schema: { "x-ts-function": true },
					signatures: [{ returns: { schema: { type: "boolean" } } }],
				},
				{
					name: "things",
					kind: "property",
					schema: { "x-ts-function": true, "x-ts-type": "Things" },
					signatures: undefined,
				},
			],
		},
		{
			name: "Things",
			kind: "interface",
			members: [
				{
					name: "()",
					kind: "call-signature",
					signatures: [{ returns: { schema: { type: "string" } } }],
				},
				{
					name: "list",
					kind: "method",
					schema: { "x-ts-function": true },
					signatures: [{ returns: { schema: { type: "number" } } }],
				},
			],
		},
		{ name: "StreamsLike", kind: "type", description: "Streams. More text." },
	],
};

const config: ReferenceConfig = {
	package: "packages/pkg",
	client: "Client",
	variable: "sl",
	docsBase: "/docs/ref",
	variant: { key: "chain", default: "stacks" },
	surfaces: [
		{ slug: "streams", title: "Streams", member: "streams" },
		{ slug: "things", title: "Things", member: "things" },
		{ slug: "client", title: "Client", only: ["ping"] },
	],
};

const noIO: ReferenceIO = { readText: () => undefined, examples: () => [] };
const build = (io: ReferenceIO = noIO) =>
	buildReference(spec, config, io, "openpkg test").files;
const surface = (slug: string, io: ReferenceIO = noIO) =>
	build(io)[`${slug}.json`] as SurfaceFile;

describe("method walk", () => {
	test("non-public and underscore-prefixed members never become methods", () => {
		const ids = surface("client").methods.map((m) => m.id);
		expect(ids).toEqual(["ping"]);
	});

	test("methods inside an inline object are found with a dotted id and path", () => {
		const m = surface("streams").methods.find((x) => x.id === "events.list");
		expect(m?.path).toBe("sl.streams.events.list");
	});

	test("a callable resource yields the call itself plus its methods", () => {
		const ids = surface("things").methods.map((m) => m.id);
		expect(ids).toEqual(["", "list"]);
		expect(surface("things").methods[0]?.path).toBe("sl.things");
	});
});

describe("overloads", () => {
	test("the default variant is listed first and each overload is labelled by its literal", () => {
		const m = surface("streams").methods.find((x) => x.id === "events.list");
		expect(m?.overloads.map((o) => o.label)).toEqual(["Stacks", "Bitcoin"]);
		expect(m?.overloads[0]?.params[0]).toMatchObject({
			name: "params",
			type: "StacksParams",
			required: false,
		});
	});

	test("each documented overload keeps its own doc and the method gets none", () => {
		const m = surface("streams").methods.find((x) => x.id === "events.list");
		expect(m?.overloads.map((o) => o.description)).toEqual([
			"Stacks rows. See [`StreamsLike.tip`](/docs/ref/streams#m-tip).",
			"Runes rows.",
		]);
		expect(m?.summary).toBe("");
		expect(m?.description).toBe("");
	});

	test("an overload's own doc never becomes the method summary", () => {
		const m = surface("streams").methods.find((x) => x.id === "stream");
		expect(m?.summary).toBe("");
		const bitcoin = m?.overloads.find((o) => o.label === "Bitcoin");
		expect(bitcoin?.description).toContain("Runes only");
		expect(m?.overloads.find((o) => o.label === "Stacks")?.description).toBe(
			"",
		);
	});

	test("a doc shared by overloads becomes the method doc, not an overload doc", () => {
		const m = surface("streams").methods.find((x) => x.id === "shared");
		expect(m?.summary).toBe(
			"Shared by both overloads, see [`Tip`](/docs/ref/streams#t-Tip).",
		);
		expect(m?.overloads.map((o) => o.description)).toEqual(["", ""]);
	});

	test("one doc repeated across an overload's signatures is the method doc", () => {
		const m = surface("streams").methods.find((x) => x.id === "repeated");
		expect(m?.summary).toBe("One doc, listed per signature.");
		expect(m?.overloads.map((o) => o.description)).toEqual(["", "", "", ""]);
	});

	test("a single-overload method carries its description on the method only", () => {
		const m = surface("client").methods[0];
		expect(m?.summary).toBe("Check the connection.");
		expect(m?.overloads[0]?.description).toBe("");
	});

	test("type parameters are kept per overload and omitted when absent", () => {
		const m = surface("streams").methods.find((x) => x.id === "stream");
		const generic = m?.overloads.find((o) => o.label === "Stacks");
		expect(generic?.typeParams).toEqual([
			{ name: "T", constraint: "readonly string[]", const: true },
		]);
		const plain = m?.overloads.find((o) => o.label === "Bitcoin");
		expect(plain && "typeParams" in plain).toBe(false);
	});
});

describe("types", () => {
	test("only types reachable from a surface's signatures are listed, transitively", () => {
		const names = surface("streams").types.map((t) => t.name);
		expect(names).toEqual(["BitcoinParams", "Page", "StacksParams", "Tip"]);
		expect(names).not.toContain("StreamsLike");
	});

	test("fields keep their required flag and description", () => {
		const page = surface("streams").types.find((t) => t.name === "Page");
		expect(page?.fields).toEqual([
			{
				name: "next",
				type: "Tip",
				required: false,
				description: "Where next.",
			},
		]);
	});
});

describe("type docs from source", () => {
	const root = mkdtempSync(join(tmpdir(), "reference-type-docs-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	function typeDoc(name: string, files: Record<string, string>) {
		const dir = join(root, String(Math.random()).slice(2));
		for (const [file, code] of Object.entries(files)) {
			const abs = join(dir, file);
			mkdirSync(join(abs, ".."), { recursive: true });
			writeFileSync(abs, code);
		}
		return fileSystemIO(dir, "packages/pkg").typeDoc?.(name);
	}

	test("the comment above a declaration is its doc, up to the first tag", () => {
		const doc = typeDoc("Tip", {
			"packages/pkg/src/a.ts":
				"/**\n * Where the chain ends.\n * @example x\n */\nexport interface Tip {}\n",
		});
		expect(doc).toBe("Where the chain ends.");
	});

	test("a generic alias keeps its doc", () => {
		const doc = typeDoc("Fields", {
			"packages/pkg/src/a.ts":
				"/** Picks columns. */\nexport type Fields<T> = Pick<T, never>;\n",
		});
		expect(doc).toBe("Picks columns.");
	});

	test("the package's own comment wins over a sibling's", () => {
		const doc = typeDoc("Tip", {
			"packages/other/src/a.ts": "/** Theirs. */\nexport type Tip = number;\n",
			"packages/pkg/src/a.ts": "/** Ours. */\nexport type Tip = string;\n",
		});
		expect(doc).toBe("Ours.");
	});

	test("a declaration without a comment has no doc", () => {
		expect(
			typeDoc("Tip", {
				"packages/pkg/src/a.ts": "export type Tip = string;\n",
			}),
		).toBeUndefined();
	});

	test("a bare alias names the type it renames", () => {
		const io = (code: string) => {
			const dir = join(root, String(Math.random()).slice(2));
			mkdirSync(join(dir, "packages/pkg/src"), { recursive: true });
			writeFileSync(join(dir, "packages/pkg/src/a.ts"), code);
			return fileSystemIO(dir, "packages/pkg");
		};
		expect(io("export type Bytes = Uint8Array;\n").aliasOf?.("Bytes")).toBe(
			"Uint8Array",
		);
		expect(
			io("export type Pair = [a: 1];\n").aliasOf?.("Pair"),
		).toBeUndefined();
	});

	test("a rename of a type outside the spec shows the name, not its members", () => {
		const io: ReferenceIO = {
			...noIO,
			aliasOf: (name) => (name === "Page" ? "Uint8Array" : undefined),
		};
		const page = surface("streams", io).types.find((t) => t.name === "Page");
		expect(page?.definition).toBe("Uint8Array");
		expect(page?.fields).toBeUndefined();
	});

	test("a type with no description of its own takes the source comment", () => {
		const io: ReferenceIO = {
			...noIO,
			typeDoc: (name) => (name === "Page" ? "A page of rows." : undefined),
		};
		const page = surface("streams", io).types.find((t) => t.name === "Page");
		expect(page?.summary).toBe("A page of rows.");
	});
});

describe("symbols", () => {
	test("methods and types map to anchors on their surface page", () => {
		const index = build()["manifest.json"] as {
			symbols: Record<string, string>;
		};
		expect(index.symbols["sl.streams.events.list"]).toBe(
			"/docs/ref/streams#m-events-list",
		);
		expect(index.symbols.Tip).toBe("/docs/ref/streams#t-Tip");
	});
});

describe("linkify", () => {
	const symbols = { Tip: "/docs/ref/streams#t-Tip" };

	test("a {@link} to a known symbol becomes a markdown link", () => {
		expect(linkify("Returns {@link Tip}.", symbols)).toBe(
			"Returns [`Tip`](/docs/ref/streams#t-Tip).",
		);
	});

	test("a {@link} with display text keeps that text", () => {
		expect(linkify("See {@link Tip the tip}.", symbols)).toBe(
			"See [the tip](/docs/ref/streams#t-Tip).",
		);
	});

	test("a {@link} to an unknown symbol falls back to inline code", () => {
		expect(linkify("See {@link Nope}.", symbols)).toBe("See `Nope`.");
	});

	test("a {@link} padded with newlines stays inline in its sentence", () => {
		expect(linkify("see\n\n{@link \nTip\n}\n.", symbols)).toBe(
			"see [`Tip`](/docs/ref/streams#t-Tip).",
		);
	});

	test("a mid-sentence {@link} keeps the words on both sides", () => {
		expect(linkify("Reads {@link Tip} and then stops.", symbols)).toBe(
			"Reads [`Tip`](/docs/ref/streams#t-Tip) and then stops.",
		);
	});

	test("an overload doc padded around a link reads as one sentence", () => {
		const m = surface("streams").methods.find((x) => x.id === "stream");
		const bitcoin = m?.overloads.find((o) => o.label === "Bitcoin");
		expect(bitcoin?.description).toBe(
			'`chain: "bitcoin"` — Runes only; see [`Tip`](/docs/ref/streams#t-Tip).',
		);
	});
});

describe("examples by path", () => {
	const root = mkdtempSync(join(tmpdir(), "reference-examples-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	function fixture(files: Record<string, string>) {
		const dir = join(root, String(Math.random()).slice(2));
		for (const [name, code] of Object.entries(files)) {
			const abs = join(dir, "packages/pkg/examples", name);
			mkdirSync(join(abs, ".."), { recursive: true });
			writeFileSync(abs, code);
		}
		return fileSystemIO(dir, "packages/pkg");
	}

	test("examples/<surface>/<method id>.ts attaches to that method", () => {
		const io = fixture({
			"streams/events.list.ts": "await sl.streams.events.list();\n",
			"streams/tip.ts": "await sl.streams.tip();\n",
			"client/ping.ts": "await sl.ping();\n",
		});
		const s = surface("streams", io);
		const list = s.methods.find((m) => m.id === "events.list");
		expect(list?.examples).toEqual([
			{
				file: "packages/pkg/examples/streams/events.list.ts",
				code: "await sl.streams.events.list();\n",
			},
		]);
		expect(s.methods.find((m) => m.id === "tip")?.examples).toHaveLength(1);
		expect(surface("client", io).methods[0]?.examples[0]?.file).toBe(
			"packages/pkg/examples/client/ping.ts",
		);
	});

	test("a surface without an examples directory has no examples", () => {
		const io = fixture({ "streams/tip.ts": "x" });
		expect(surface("things", io).methods.every((m) => !m.examples.length)).toBe(
			true,
		);
	});

	test("an example naming no method fails loudly", () => {
		const io = fixture({ "streams/events.lst.ts": "x" });
		expect(() => surface("streams", io)).toThrow(/names no method/);
	});
});

describe("REST pairing", () => {
	const text = [
		"export class Hooks {",
		"\tasync list(): Promise<{ data: X[] }> {",
		'\t\treturn this.request<{ data: X[] }>("GET", "/api/hooks");',
		"\t}",
		"\tasync get(id: string): Promise<Y> {",
		'\t\treturn this.request<Y>("GET", `/api/hooks/${seg(id)}`);',
		"\t}",
		"\tasync viaHelper(): Promise<Z> {",
		"\t\treturn this.build();",
		"\t}",
		"}",
	].join("\n");

	test("a literal request path is read from the method body", () => {
		expect(restFor(text, 1, ["list"])).toBe("GET /api/hooks");
	});

	test("interpolated segments become {name} placeholders", () => {
		expect(restFor(text, 1, ["get"])).toBe("GET /api/hooks/{id}");
	});

	test("a method with no literal request is skipped", () => {
		expect(restFor(text, 1, ["viaHelper"])).toBeNull();
	});
});
