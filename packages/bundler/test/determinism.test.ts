import { describe, expect, test } from "bun:test";
import {
	computePin,
	deriveVerification,
	isDeterminismViolation,
} from "@secondlayer/subgraphs/verification";
import { scanHandlerDeterminism } from "../src/determinism.ts";
import { bundleSubgraphCode } from "../src/subgraph.ts";

const names = (code: string) =>
	scanHandlerDeterminism(code).map((f) => `${f.kind}:${f.name}`);

describe("scanHandlerDeterminism", () => {
	test("flags forbidden globals, inexact Math and locale methods", () => {
		expect(
			names(`
				const a = Date.now();
				const b = Math.random() + Math.sin(1) + Math.floor(2.5);
				const c = (1n).toLocaleString();
				fetch("x"); setTimeout(() => {}, 1); new Intl.NumberFormat();
			`),
		).toEqual([
			"nondeterministic:Date",
			"nondeterministic:Math.random",
			"nondeterministic:Math.sin",
			"nondeterministic:toLocaleString",
			"nondeterministic:fetch",
			"nondeterministic:setTimeout",
			"nondeterministic:Intl",
		]);
	});

	test("allows spec-exact built-ins and every locally declared name", () => {
		expect(
			names(`
				function f(Date) { return Date + 1; }
				const { performance } = { performance: 1 };
				const m = new Map([[1n, "a"]]); const s = JSON.stringify([...m]);
				const n = BigInt(Number.MAX_SAFE_INTEGER) + Math.max(1, 2) + Math.PI;
				const u = new TextEncoder().encode(s) instanceof Uint8Array;
				if (typeof window !== "undefined") console.log(u, n, performance, f);
				const o = { Date: 1, process: 2 }; o.fetch = o.Date;
			`),
		).toEqual([]);
	});

	test("flags unknown globals, code generation, imports and import.meta", () => {
		expect(
			names(`
				import fs from "node:fs";
				const b = Buffer.from("00", "hex");
				const g = new Function("return 1");
				const lazy = () => import("./x.js");
				const url = import.meta.url;
			`),
		).toEqual([
			'nondeterministic:import "node:fs"',
			"nondeterministic:Buffer",
			"nondeterministic:Function()",
			"nondeterministic:import()",
			"nondeterministic:import.meta",
		]);
	});

	test("ctx.client reads raise the level instead of breaking determinism", () => {
		expect(
			names(`
				const h = async (e, ctx) => { await ctx.client.readOnly("x"); };
				const k = async (e, { client }) => client;
			`),
		).toEqual(["needs-l3:ctx.client", "needs-l3:ctx.client"]);
	});
});

const L2_SOURCES = `
	sources: { reserve: { type: "map_set", contractId: "SP1.vault", map: "reserve" } },`;
const L3_SOURCES = `
	sources: { swaps: { type: "print_event", contractId: "SP1.amm", prints: { swap: { amount: "uint" } } } },`;
const subgraph = (sources: string, handlerBody: string) => `
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
	name: "pool-reserves",
	startBlock: 1_230_000,${sources}
	schema: { reserves: { columns: { token: { type: "text" }, at: { type: "uint" } } } },
	handlers: {
		${sources.includes("reserve") ? "reserve" : "swaps"}: (event, ctx) => {
			${handlerBody}
		},
	},
});
`;

describe("bundleSubgraphCode determinism findings", () => {
	test("forbidden global in an L2 subgraph is a violation with its source position", async () => {
		const bundled = await bundleSubgraphCode(
			subgraph(
				L2_SOURCES,
				'ctx.insert("reserves", { token: "a", at: Date.now() });',
			),
			{ fileName: "subgraphs/pool-reserves.ts" },
		);
		expect(bundled.findings).toEqual([
			{
				kind: "nondeterministic",
				name: "Date",
				reason: "wall-clock time differs per run",
				file: "subgraphs/pool-reserves.ts",
				line: 11,
				column: 45,
			},
		]);
		const v = deriveVerification(
			{ sources: bundled.sources as never },
			bundled.findings,
		);
		expect(v.level).toBe("L2");
		expect(v.verifiable).toBe(false);
		expect(v.reasons).toEqual([
			"subgraphs/pool-reserves.ts:11:45 Date: wall-clock time differs per run",
		]);
		expect(isDeterminismViolation(v)).toBe(true);
	});

	test("the same code in an L3 subgraph is advice, not a violation", async () => {
		const bundled = await bundleSubgraphCode(
			subgraph(
				L3_SOURCES,
				'ctx.insert("reserves", { token: "a", at: Date.now() });',
			),
		);
		const v = deriveVerification(
			{ sources: bundled.sources as never },
			bundled.findings,
		);
		expect(v.level).toBe("L3");
		expect(isDeterminismViolation(v)).toBe(false);
		expect(v.reasons).toEqual([
			'print_event source "swaps" needs L3',
			"subgraph.ts:11:45 Date: wall-clock time differs per run",
		]);
	});

	test("rebuilding identical source yields the same pin; a handler edit changes it", async () => {
		const source = subgraph(
			L2_SOURCES,
			'ctx.upsert("reserves", { token: String(event.key) }, { at: event.value });',
		);
		const pinOf = async (code: string) =>
			computePin({
				schemaHash: "s".repeat(64),
				handlerCode: (await bundleSubgraphCode(code)).handlerCode,
				startBlock: 1_230_000,
				network: "mainnet",
			});
		const first = await pinOf(source);
		expect(await pinOf(source)).toBe(first);
		expect(
			await pinOf(source.replace("String(event.key)", "`${event.key}`")),
		).not.toBe(first);
	});

	test("a clean L2 subgraph is verifiable", async () => {
		const bundled = await bundleSubgraphCode(
			subgraph(
				L2_SOURCES,
				'ctx.upsert("reserves", { token: String(event.key) }, { at: event.value });',
			),
		);
		expect(bundled.findings).toEqual([]);
		const v = deriveVerification({ sources: bundled.sources as never });
		expect(v).toMatchObject({ level: "L2", verifiable: true, reasons: [] });
	});
});
