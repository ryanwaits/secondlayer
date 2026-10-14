import { describe, expect, test } from "bun:test";
import {
	type FunctionReferenceConfig,
	type ReferenceIO,
	type SurfaceFile,
	buildReference,
} from "../../../scripts/reference/build";
import { mergeSpecs } from "../../../scripts/reference/extract";
import { renderType } from "../../../scripts/reference/render";
import { hasHiddenConstructor } from "../../../scripts/reference/source";
import type { Spec } from "../../../scripts/reference/walk";

const str = { type: "string" };
const num = { type: "number" };

const spec: Spec = {
	meta: { name: "@x/lib", version: "2.0.0" },
	types: [
		{
			name: "Namespace",
			kind: "type",
			schema: {
				type: "object",
				properties: {
					first: {
						description: "Builds the first thing.",
						"x-ts-function": true,
						"x-ts-signatures": [{ returns: { schema: str } }],
					},
					second: {
						"x-ts-function": true,
						"x-ts-signatures": [{ returns: { schema: num } }],
					},
				},
			},
		},
		{
			name: "Options",
			kind: "interface",
			schema: {
				type: "object",
				properties: { retries: { ...num, description: "How many." } },
			},
		},
		{
			name: "Store",
			kind: "interface",
			schema: {
				type: "object",
				properties: { put: { "x-ts-function": true } },
			},
		},
	],
	exports: [
		{
			name: "build",
			kind: "function",
			description: "Build a thing from options. More text.",
			source: { file: "src/build.ts", line: 3 },
			signatures: [
				{
					parameters: [
						{
							name: "options",
							required: true,
							schema: { $ref: "#/types/Options" },
						},
					],
					returns: { schema: str },
				},
			],
		},
		{
			name: "Source",
			kind: "class",
			description: "Reads things from a node.",
			source: { file: "src/source.ts", line: 1 },
			signatures: [
				{
					parameters: [
						{
							name: "options",
							required: false,
							schema: { $ref: "#/types/Options" },
						},
					],
				},
			],
			members: [
				{
					name: "get",
					kind: "property",
					description: "Read one thing.",
					schema: {
						"x-ts-function": true,
						"x-ts-signatures": [
							{
								parameters: [{ name: "id", required: true, schema: str }],
								returns: { schema: str },
							},
						],
					},
				},
				{
					name: "make",
					kind: "method",
					flags: { static: true },
					schema: { "x-ts-function": true },
					signatures: [{ returns: { schema: str } }],
				},
				{
					name: "secret",
					kind: "method",
					visibility: "private",
					schema: { "x-ts-function": true },
					signatures: [{ returns: { schema: str } }],
				},
			],
		},
		{
			name: "Chain",
			kind: "class",
			source: { file: "src/chain.ts", line: 1 },
			signatures: [{ parameters: [] }],
			members: [
				{
					name: "from",
					kind: "method",
					flags: { static: true },
					schema: { "x-ts-function": true },
					signatures: [{ returns: { schema: str } }],
				},
			],
		},
		{
			name: "Boom",
			kind: "class",
			source: { file: "src/errors.ts", line: 1 },
			members: [],
		},
		{
			name: "on",
			kind: "variable",
			source: { file: "src/on.ts", line: 4 },
			schema: { $ref: "#/types/Namespace" },
		},
		{
			name: "LIMIT",
			kind: "variable",
			description: "The most things at once.",
			source: { file: "src/limits.ts", line: 1 },
			schema: { const: 25 },
		},
		{
			name: "Store",
			kind: "interface",
			source: { file: "src/store.ts", line: 1 },
			members: [
				{
					name: "put",
					kind: "method",
					description: "Write one thing.",
					schema: { "x-ts-function": true },
					signatures: [
						{
							parameters: [{ name: "id", required: true, schema: str }],
							returns: { schema: { type: "null", "x-ts-type": "void" } },
						},
					],
				},
			],
		},
		{
			name: "external",
			kind: "function",
			description: "Declared in another package.",
			source: { file: "db/queries/things.d.ts", line: 1 },
			signatures: [{ returns: { schema: str } }],
		},
	],
};

const config: FunctionReferenceConfig = {
	package: "packages/lib",
	docsBase: "/docs/lib-reference",
	groups: [
		{
			slug: "store",
			title: "Store",
			members: { type: "Store", root: "store" },
		},
		{
			slug: "builders",
			title: "Builders",
			from: "@x/lib/builders",
			files: /^src\/(build|on)\.ts$/,
		},
		{
			slug: "sources",
			title: "Sources",
			files: /^src\/(source|chain|errors|limits)\.ts$/,
			names: ["external"],
		},
	],
};

const reader = (text: Record<string, string> = {}): ReferenceIO => ({
	readText: (path) => text[path],
	examples: () => [],
});

const build = (io = reader()) =>
	buildReference(spec, config, io, "openpkg test");
const group = (slug: string, io = reader()) =>
	build(io).files[`${slug}.json`] as SurfaceFile;

describe("function-first reference", () => {
	test("a function is one method named after its export, with no root prefix", () => {
		const m = group("builders").methods.find((x) => x.id === "build");
		expect(m).toMatchObject({
			path: "build",
			source: { file: "packages/lib/src/build.ts", line: 3 },
		});
		expect(m?.overloads[0]?.params[0]?.name).toBe("options");
	});

	test("a namespace object lists its callable members under its own name", () => {
		const ids = group("builders").methods.map((m) => m.id);
		expect(ids).toEqual(["build", "on.first", "on.second"]);
		const first = group("builders").methods.find((m) => m.id === "on.first");
		expect(first?.path).toBe("on.first");
		expect(first?.source).toEqual({ file: "packages/lib/src/on.ts", line: 4 });
	});

	test("a class is its constructor first, then its public instance and static members", () => {
		const ids = group("sources").methods.map((m) => m.id);
		expect(ids).toEqual([
			"Source",
			"Source.get",
			"Source.make",
			"Chain",
			"Chain.from",
			"external",
		]);
		const ctor = group("sources").methods.find((m) => m.id === "Source");
		expect(ctor).toMatchObject({
			path: "new Source",
			description: "Reads things from a node.",
		});
		expect(ctor?.overloads[0]?.returns.type).toBe("");
	});

	test("a property holding a function documents its own signature", () => {
		const get = group("sources").methods.find((m) => m.id === "Source.get");
		expect(get?.overloads[0]?.params[0]?.name).toBe("id");
		expect(get?.summary).toBe("Read one thing.");
	});

	test("a class whose constructor is private lists its factory, not a constructor", () => {
		const text = {
			"packages/lib/src/chain.ts":
				"export class Chain {\n\tprivate constructor(a: number) {}\n\tstatic from() {}\n}\n",
		};
		const methods = group("sources", reader(text)).methods.map((m) => m.id);
		expect(methods).toContain("Chain.from");
		expect(methods).not.toContain("Chain");
		expect(group("sources", reader(text)).types.map((t) => t.name)).toContain(
			"Chain",
		);
	});

	test("a class nothing constructs is listed with the types", () => {
		expect(group("sources").methods.map((m) => m.id)).not.toContain("Boom");
		expect(group("sources").types.map((t) => t.name)).toContain("Boom");
	});

	test("a value that is not callable is a constant with its literal type", () => {
		expect(group("sources").constants).toEqual([
			{
				name: "LIMIT",
				summary: "The most things at once.",
				type: "25",
				source: { file: "packages/lib/src/limits.ts", line: 1 },
			},
		]);
	});

	test("a group can document an interface's methods under a root name", () => {
		const store = group("store");
		expect(store.methods.map((m) => m.path)).toEqual(["store.put"]);
		expect(store.root).toBe("");
	});

	test("a declaration followed into another package's types has no source link", () => {
		const external = group("sources").methods.find((m) => m.id === "external");
		expect(external?.source).toBeNull();
	});

	test("a group's import specifier travels with its file", () => {
		expect(group("builders").from).toBe("@x/lib/builders");
		expect(group("store").from).toBeUndefined();
	});

	test("every anchor hangs off the one page, and a class name opens its constructor", () => {
		const { symbols } = build().files["manifest.json"] as {
			symbols: Record<string, string>;
		};
		expect(symbols.build).toBe("/docs/lib-reference#m-build");
		expect(symbols["on.first"]).toBe("/docs/lib-reference#m-on-first");
		expect(symbols.Source).toBe("/docs/lib-reference#m-Source");
		expect(symbols.LIMIT).toBe("/docs/lib-reference#c-LIMIT");
		expect(symbols.Options).toMatch(/^\/docs\/lib-reference#t-Options$/);
	});

	test("the manifest counts methods per group and carries no helpers or errors", () => {
		const manifest = build().files["manifest.json"] as {
			surfaces: { slug: string; methodCount: number }[];
			helpers: unknown[];
			errors: unknown[];
		};
		expect(manifest.surfaces.map((s) => [s.slug, s.methodCount])).toEqual([
			["store", 1],
			["builders", 3],
			["sources", 6],
		]);
		expect(manifest.helpers).toEqual([]);
		expect(manifest.errors).toEqual([]);
	});

	test("a function no group claims is reported, never dropped", () => {
		const lonely: FunctionReferenceConfig = {
			...config,
			groups: [config.groups[1] as FunctionReferenceConfig["groups"][number]],
		};
		const { unresolved } = buildReference(
			spec,
			lonely,
			reader(),
			"openpkg test",
		);
		expect(unresolved.map((u) => u.path)).toContain("Source");
		expect(unresolved.find((u) => u.path === "Source")?.reason).toBe(
			"no group claims this export",
		);
	});

	test("a group is claimed by its @group tag too", () => {
		const tagged: Spec = {
			...spec,
			exports: [
				{
					name: "tagged",
					kind: "function",
					tags: [{ name: "group", text: "Tools" }],
					source: { file: "src/anywhere.ts", line: 1 },
					signatures: [{ returns: { schema: str } }],
				},
			],
		};
		const cfg: FunctionReferenceConfig = {
			...config,
			groups: [{ slug: "tools", title: "Tools", tag: "Tools" }],
		};
		const result = buildReference(tagged, cfg, reader(), "openpkg test");
		expect(
			(result.files["tools.json"] as SurfaceFile).methods.map((m) => m.id),
		).toEqual(["tagged"]);
	});
});

describe("entries merged from subpath exports", () => {
	const a: Spec = {
		meta: { name: "a", version: "1" },
		exports: [{ name: "shared", kind: "function", description: "from a" }],
		types: [{ name: "T", kind: "type", description: "a" }],
	};
	const b: Spec = {
		meta: { name: "b", version: "2" },
		exports: [
			{ name: "shared", kind: "function", description: "from b" },
			{ name: "only", kind: "function" },
		],
		types: [
			{ name: "T", kind: "type", description: "b" },
			{ name: "U", kind: "type" },
		],
	};

	test("the first entry wins a name both export and the rest add theirs", () => {
		const merged = mergeSpecs([a, b]);
		expect(merged.meta.name).toBe("a");
		expect(merged.exports.map((e) => [e.name, e.description])).toEqual([
			["shared", "from a"],
			["only", undefined],
		]);
		expect(merged.types.map((t) => t.name)).toEqual(["T", "U"]);
	});
});

describe("hidden constructors", () => {
	test("private and protected constructors hide; the next class's does not count", () => {
		const text = [
			"export class A {",
			"\tprivate constructor() {}",
			"}",
			"export class B {",
			"\tconstructor(x: number) {}",
			"}",
			"export class C {",
			"\tstatic make() {}",
			"}",
			"export class D {",
			"\tprotected constructor() {}",
			"}",
		].join("\n");
		expect(hasHiddenConstructor(text, 1)).toBe(true);
		expect(hasHiddenConstructor(text, 4)).toBe(false);
		expect(hasHiddenConstructor(text, 7)).toBe(false);
		expect(hasHiddenConstructor(text, 10)).toBe(true);
	});
});

describe("tuple types", () => {
	test("a tuple of literals reads as its positional types", () => {
		const text = renderType(
			{
				type: "array",
				prefixItems: [
					{ type: "string", enum: ["a"] },
					{ type: "string", enum: ["b"] },
				],
			},
			{ known: new Set() },
		);
		expect(text).toBe('["a", "b"]');
	});
});
