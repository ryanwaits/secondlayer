import { describe, expect, test } from "bun:test";
import {
	type Schema,
	type Signature,
	renderReturns,
	renderType,
} from "../../../scripts/reference/render";

const known = new Set(["StreamsFilterValue", "Envelope"]);
const ctx = () => ({ known, refs: new Set<string>() });

describe("renderType", () => {
	test("a $ref prints its type name with type arguments", () => {
		const schema: Schema = {
			$ref: "#/types/Envelope",
			"x-ts-type-arguments": [{ $ref: "#/types/Row" }, { type: "string" }],
		};
		const c = ctx();
		expect(renderType(schema, c)).toBe("Envelope<Row, string>");
		expect([...c.refs]).toEqual(["Envelope", "Row"]);
	});

	test("a namespaced $ref drops the namespace", () => {
		expect(renderType({ $ref: "#/types/base.FetchLike" }, ctx())).toBe(
			"FetchLike",
		);
	});

	test("a named generic keeps its type arguments instead of printing object", () => {
		const schema: Schema = {
			type: "object",
			"x-ts-type": "Promise",
			"x-ts-type-arguments": [{ type: "string" }],
		};
		expect(renderType(schema, ctx())).toBe("Promise<string>");
	});

	test("an author-written alias that exists in the spec replaces its expansion", () => {
		const schema: Schema = {
			anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
			"x-ts-declared": "StreamsFilterValue",
		};
		expect(renderType(schema, ctx())).toBe("StreamsFilterValue");
	});

	test("a declared type parameter is never trusted as an alias", () => {
		const schema: Schema = {
			type: "string",
			enum: ["print"],
			"x-ts-declared": "T",
		};
		expect(renderType(schema, ctx())).toBe('"print"');
	});

	test("a union that carries x-ts-type renders that text verbatim", () => {
		const schema: Schema = {
			anyOf: [
				{ type: "string" },
				{ type: "array", "x-ts-type": "ReadonlyArray" },
			],
			"x-ts-type": "string | readonly string[]",
		};
		expect(renderType(schema, ctx())).toBe("string | readonly string[]");
	});

	test("a verbatim union still records the types its arms reference", () => {
		const schema: Schema = {
			anyOf: [{ $ref: "#/types/Row" }, { type: "null" }],
			"x-ts-type": "Row | null",
		};
		const c = ctx();
		renderType(schema, c);
		expect([...c.refs]).toEqual(["Row"]);
	});

	test("union arms put null and undefined last and drop duplicates", () => {
		const schema: Schema = {
			anyOf: [
				{ type: "null" },
				{ type: "string" },
				{ type: "string" },
				{ type: "number" },
			],
		};
		expect(renderType(schema, ctx())).toBe("string | number | null");
	});

	test("an undefined arm renders as undefined, not null", () => {
		const schema: Schema = {
			anyOf: [{ type: "null", "x-ts-type": "undefined" }, { type: "string" }],
		};
		expect(renderType(schema, ctx())).toBe("string | undefined");
	});

	test("void return renders as void; only a real null renders null", () => {
		const returns = (x: string | undefined): Schema => ({
			type: "null",
			...(x ? { "x-ts-type": x } : {}),
		});
		expect(renderType(returns("void"), ctx())).toBe("void");
		expect(renderType(returns("undefined"), ctx())).toBe("undefined");
		expect(renderType(returns(undefined), ctx())).toBe("null");
		expect(
			renderType(
				{
					type: "object",
					"x-ts-type": "Promise",
					"x-ts-type-arguments": [returns("void")],
				},
				ctx(),
			),
		).toBe("Promise<void>");
	});

	test("string enums become literal unions and single values a literal", () => {
		expect(renderType({ type: "string", enum: ["a", "b"] }, ctx())).toBe(
			'"a" | "b"',
		);
		expect(renderType({ type: "number", enum: [401] }, ctx())).toBe("401");
	});

	test("intersections join their arms with &", () => {
		const schema: Schema = {
			allOf: [{ $ref: "#/types/A" }, { $ref: "#/types/B" }],
		};
		expect(renderType(schema, ctx())).toBe("A & B");
	});

	test("inline object arms of an intersection list their members, never object", () => {
		const schema: Schema = {
			allOf: [
				{ $ref: "#/types/Common" },
				{
					type: "object",
					properties: {
						chain: { type: "string", enum: ["stacks"] },
						limit: { type: "number" },
					},
					required: ["chain"],
				},
			],
		};
		expect(renderType(schema, ctx())).toBe(
			'Common & { chain: "stacks"; limit?: number }',
		);
	});

	test("a union inside an intersection is parenthesised", () => {
		const schema: Schema = {
			allOf: [
				{ $ref: "#/types/A" },
				{ anyOf: [{ $ref: "#/types/B" }, { $ref: "#/types/C" }] },
			],
		};
		expect(renderType(schema, ctx())).toBe("A & (B | C)");
	});

	test("arrays wrap unions and honor readonly", () => {
		const items: Schema = { anyOf: [{ type: "string" }, { type: "number" }] };
		expect(renderType({ type: "array", items }, ctx())).toBe(
			"(string | number)[]",
		);
		expect(
			renderType(
				{ type: "array", items: { type: "string" }, "x-ts-readonly": true },
				ctx(),
			),
		).toBe("readonly string[]");
	});

	test("maps with value types render as Record", () => {
		const schema: Schema = {
			type: "object",
			properties: {},
			additionalProperties: { type: "number" },
		};
		expect(renderType(schema, ctx())).toBe("Record<string, number>");
	});

	test("a single-signature function prints as an arrow type", () => {
		const schema: Schema = {
			"x-ts-function": true,
			"x-ts-signatures": [
				{
					parameters: [
						{ name: "id", schema: { type: "string" }, required: true },
					],
					returns: { schema: { type: "boolean" } },
				},
			],
		};
		expect(renderType(schema, ctx())).toBe("(id: string) => boolean");
	});

	test("a function used as a union arm is parenthesised", () => {
		const fn: Schema = { "x-ts-function": true, "x-ts-type": "() => void" };
		expect(renderType({ anyOf: [fn, { type: "string" }] }, ctx())).toBe(
			"(() => void) | string",
		);
	});

	test("a type-predicate return prints as `param is Type`", () => {
		const returns: Signature["returns"] = {
			schema: {
				type: "boolean",
				"x-ts-type-predicate": {
					parameterName: "event",
					type: { $ref: "#/types/FtTransfer" },
				},
			},
		};
		expect(renderReturns(returns, ctx())).toBe("event is FtTransfer");
	});

	test("a schema with nothing to say is unknown", () => {
		expect(renderType(undefined, ctx())).toBe("unknown");
	});
});
