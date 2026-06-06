import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ByoBreakingChangeError } from "@secondlayer/subgraphs";
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import { Hono } from "hono";
import { errorHandler } from "../src/middleware/error.ts";
import {
	applyDeployStartBlockOverride,
	hasDeployStartBlockChanged,
	pruneSubgraphHandlerFiles,
	resolveDeployStartBlock,
	subgraphHandlerPath,
} from "../src/routes/subgraphs.ts";

const def = {
	name: "demo-subgraph",
	startBlock: 10,
	sources: {
		events: { type: "print_event", contractId: "SP123.demo", topic: "event" },
	},
	schema: {
		events: {
			columns: {
				sender: { type: "principal" },
			},
		},
	},
	handlers: {
		events: () => {},
	},
} as unknown as SubgraphDefinition;

describe("subgraph deploy helpers", () => {
	test("overrides imported definition startBlock when request provides one", () => {
		const overridden = applyDeployStartBlockOverride(def, 123);
		expect(overridden).not.toBe(def);
		expect(overridden.startBlock).toBe(123);
		expect(def.startBlock).toBe(10);
	});

	test("keeps imported definition unchanged without request startBlock", () => {
		expect(applyDeployStartBlockOverride(def)).toBe(def);
	});

	test("resolves deploy start block defaults and explicit zero", () => {
		expect(resolveDeployStartBlock({ ...def, startBlock: undefined })).toBe(1);
		expect(resolveDeployStartBlock({ ...def, startBlock: 0 })).toBe(0);
	});

	test("detects start-block-only redeploys as reindex-worthy", () => {
		expect(
			hasDeployStartBlockChanged({
				existingStartBlock: 1,
				definitionStartBlock: 7799262,
			}),
		).toBe(true);
		expect(
			hasDeployStartBlockChanged({
				existingStartBlock: 7799262,
				definitionStartBlock: 7799262,
			}),
		).toBe(false);
		expect(
			hasDeployStartBlockChanged({
				existingStartBlock: 1,
				definitionStartBlock: undefined,
			}),
		).toBe(false);
	});

	test("gives each deploy a unique handler filename", () => {
		const dir = "data/subgraphs";
		expect(subgraphHandlerPath(dir, "sbtc-activity", 123)).toBe(
			join(dir, "sbtc-activity.123.js"),
		);
		// Distinct busts → distinct paths (so import() loads fresh under Bun).
		expect(subgraphHandlerPath(dir, "x", 1)).not.toBe(
			subgraphHandlerPath(dir, "x", 2),
		);
	});

	test("prunes only this subgraph's prior handler files", () => {
		const dir = mkdtempSync(join(tmpdir(), "sg-prune-"));
		for (const f of [
			"demo.js", // legacy
			"demo.111.js", // busted
			"demo.222.js", // busted
			"demo-other.999.js", // different subgraph (prefix collision guard)
			"keep.js",
		]) {
			writeFileSync(join(dir, f), "");
		}
		pruneSubgraphHandlerFiles(dir, "demo");
		expect(readdirSync(dir).sort()).toEqual(["demo-other.999.js", "keep.js"]);
	});

	// The deploy route has no try/catch — a ByoBreakingChangeError thrown by
	// deploySchema (on a breaking BYO redeploy) bubbles to the global onError
	// handler. This proves the cross-bundle propagation the route relies on:
	// code-based match → 422, details spread verbatim. (The full deploy pipeline
	// needs auth + a bundle upload + a scratch BYO Postgres; the contract that
	// matters here is the error→response mapping, exercised with the real class.)
	test("ByoBreakingChangeError maps to 422 with the migration plan body", async () => {
		const app = new Hono();
		app.onError(errorHandler);
		app.post("/deploy", () => {
			throw new ByoBreakingChangeError(
				["transfers: removed columns [amount]"],
				{
					addedTables: [],
					removedTables: [],
					addedColumns: {},
					breakingChanges: ["transfers: removed columns [amount]"],
				},
				{
					schemaName: "sg_demo",
					dropStatement: 'DROP SCHEMA IF EXISTS "sg_demo" CASCADE;',
					statements: ["CREATE SCHEMA sg_demo", "CREATE TABLE …"],
					grantScript: "-- Run once …",
				},
			);
		});

		const res = await app.request("/deploy", { method: "POST" });
		expect(res.status).toBe(422);
		const body = (await res.json()) as {
			code: string;
			details: {
				reasons: string[];
				plan: { dropStatement: string };
			};
		};
		expect(body.code).toBe("BYO_BREAKING_CHANGE");
		expect(body.details.reasons.length).toBeGreaterThan(0);
		expect(body.details.plan.dropStatement).toBe(
			'DROP SCHEMA IF EXISTS "sg_demo" CASCADE;',
		);
	});

	test("Bun loads fresh module content from a unique path (regression)", async () => {
		// Bun ignores ?query cache-busting for file: imports — the deploy route
		// relies on unique filenames instead. Prove a new path picks up new code.
		const dir = mkdtempSync(join(tmpdir(), "sg-import-"));
		const p1 = subgraphHandlerPath(dir, "h", 1);
		writeFileSync(p1, "export const v = 1;");
		const p2 = subgraphHandlerPath(dir, "h", 2);
		writeFileSync(p2, "export const v = 2;");
		const m1 = await import(pathToFileURL(p1).href);
		const m2 = await import(pathToFileURL(p2).href);
		expect(m1.v).toBe(1);
		expect(m2.v).toBe(2);
	});
});
