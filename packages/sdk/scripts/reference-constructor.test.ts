import { describe, expect, test } from "bun:test";
import {
	type ReferenceConfig,
	type SurfaceFile,
	buildReference,
} from "../../../scripts/reference/build";
import type { Spec } from "../../../scripts/reference/walk";

const spec: Spec = {
	meta: { name: "@x/pkg", version: "1.0.0" },
	types: [
		{
			name: "Fetcher",
			kind: "type",
			schema: { type: "object", properties: {} },
		},
	],
	exports: [
		{
			name: "Client",
			kind: "class",
			source: { file: "src/client.ts", line: 10 },
			signatures: [
				{
					parameters: [
						{
							name: "options",
							required: false,
							schema: {
								type: "object",
								properties: {
									baseUrl: { type: "string", description: "Where the API is." },
									fetchImpl: {
										$ref: "#/types/Fetcher",
										description: "Your own fetch. See {@link Fetcher}.",
									},
								},
							},
						},
					],
				},
			],
			members: [
				{
					name: "ping",
					kind: "method",
					schema: { "x-ts-function": true },
					signatures: [
						{
							returns: {
								schema: { type: "null", "x-ts-type": "void" },
							},
						},
					],
				},
			],
		},
	],
};

const config: ReferenceConfig = {
	package: "packages/pkg",
	client: "Client",
	variable: "sl",
	docsBase: "/docs/ref",
	surfaces: [
		{ slug: "client", title: "Client", only: ["ping"], withConstructor: true },
		{ slug: "other", title: "Other", only: ["ping"] },
	],
};

const files = buildReference(
	spec,
	config,
	{ readText: () => undefined, examples: () => [] },
	"openpkg test",
).files;
const client = files["client.json"] as SurfaceFile;
const ctor = client.constructor as NonNullable<SurfaceFile["constructor"]>;

describe("constructor", () => {
	test("the surface that asks for it carries the class's constructor overloads", () => {
		expect(ctor.name).toBe("Client");
		expect(ctor.source).toEqual({
			file: "packages/pkg/src/client.ts",
			line: 10,
		});
		expect(ctor.overloads).toHaveLength(1);
	});

	test("an options object opens into documented fields, with links resolved", () => {
		const options = ctor.overloads[0]?.params[0];
		expect(options?.name).toBe("options");
		expect(options?.required).toBe(false);
		expect(options?.fields?.map((f) => f.name)).toEqual([
			"baseUrl",
			"fetchImpl",
		]);
		expect(options?.fields?.[0]?.description).toBe("Where the API is.");
		expect(options?.fields?.[1]?.description).toBe(
			"Your own fetch. See [`Fetcher`](/docs/ref/client#t-Fetcher).",
		);
	});

	test("a constructor does not repeat its class as a return type", () => {
		expect(ctor.overloads[0]?.returns.type).toBe("");
	});

	test("types its options mention are listed on the surface", () => {
		expect(client.types.map((t) => t.name)).toContain("Fetcher");
	});

	test("a surface that does not ask has no constructor key of its own", () => {
		const other = files["other.json"] as SurfaceFile;
		expect(Object.prototype.hasOwnProperty.call(other, "constructor")).toBe(
			false,
		);
	});
});

describe("void", () => {
	test("a void return reaches the reference as void, not null", () => {
		const m = client.methods.find((x) => x.id === "ping");
		expect(m?.overloads[0]?.returns.type).toBe("void");
	});
});
