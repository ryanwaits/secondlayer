import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractSubgraphDefinition } from "@secondlayer/bundler";
import { getDb } from "@secondlayer/shared/db";
import { pgSchemaNameFor } from "@secondlayer/shared/db/queries/subgraphs";
import { ByoBreakingChangeError } from "@secondlayer/subgraphs";
import type { SubgraphDefinition } from "@secondlayer/subgraphs";
import { Hono } from "hono";
import { sql } from "kysely";
import {
	type PrintSchemaBody,
	printSchemaCache,
} from "../src/index/print-schema.ts";
import { errorHandler } from "../src/middleware/error.ts";
import subgraphsRouter, {
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

	// f059: the deploy route derives `def` from `handlerCode` via
	// extractSubgraphDefinition + applyDeployStartBlockOverride WITHOUT ever
	// import()-ing it. Prove that pipeline yields the expected definition and
	// never executes a top-level side effect in the (bundled-shaped) source.
	test("extracts the deploy definition from handlerCode without executing it", () => {
		(globalThis as Record<string, unknown>).__f059_deploy_pwned = undefined;
		const handlerCode = [
			"function defineSubgraph(def) { return def; }",
			"globalThis.__f059_deploy_pwned = true;",
			"var x = defineSubgraph({",
			'  name: "deploy-extract-demo",',
			"  startBlock: 10,",
			"  sources: {",
			'    events: { type: "print_event", contractId: "SP123.demo", topic: "event" },',
			"  },",
			"  schema: {",
			'    events: { columns: { sender: { type: "principal" } } },',
			"  },",
			"  handlers: { events: function (event, ctx) {} },",
			"});",
			"export { x as default };",
		].join("\n");

		const extracted = extractSubgraphDefinition(handlerCode);
		const overridden = applyDeployStartBlockOverride(
			{
				...extracted,
				handlers: extracted.handlerSources,
			} as unknown as SubgraphDefinition,
			123,
		);

		expect(overridden.name).toBe("deploy-extract-demo");
		expect(overridden.startBlock).toBe(123);
		expect(Object.keys(overridden.sources)).toEqual(["events"]);
		expect(
			(globalThis as Record<string, unknown>).__f059_deploy_pwned,
		).toBeUndefined();
	});
});

// ── deploy-time print-field lint (route) ─────────────────────────────────
//
// The fake schema is injected by priming the shared print-schema LRU — the
// deploy lint reads through getPrintSchemaBody, which hits the cache before
// any decoded_events query. DB-gated only because the deploy route touches
// getChainTip / deploySchema, not because the lint needs chain data.

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("deploy print-field lint (route)", () => {
	const LINT_CONTRACT = "SP123.print-lint-demo";
	const LIVE_SUBGRAPH = "print-lint-live-sg";

	const app = new Hono();
	app.onError(errorHandler);
	app.route("/subgraphs", subgraphsRouter);

	beforeAll(() => {
		const body: PrintSchemaBody = {
			contract_id: LINT_CONTRACT,
			topics: [
				{
					topic: "completed-deposit",
					count: 5,
					first_height: 1,
					last_height: 2,
					non_tuple: false,
					fields: [
						{
							name: "amount",
							camel_name: "amount",
							clarity_type: "uint",
							ts_type: "bigint",
							column_type: "uint",
							always_present: true,
						},
					],
				},
			],
			sampled: false,
			total_events: 5,
			total_events_capped: false,
			sample: { size: 5, newest_height: 2, oldest_height: 1 },
		};
		printSchemaCache.set(LINT_CONTRACT, body);
	});

	afterAll(async () => {
		printSchemaCache.clear();
		// The deploy route persists each handler under DATA_DIR — drop ours so
		// test runs don't accumulate untracked files.
		for (const name of [
			"print-lint-dryrun-sg",
			"print-lint-clean-sg",
			"print-lint-trait-sg",
			LIVE_SUBGRAPH,
		]) {
			pruneSubgraphHandlerFiles(
				join(process.env.DATA_DIR ?? "./data", "subgraphs"),
				name,
			);
		}
		const db = getDb();
		await db
			.deleteFrom("subgraph_operations")
			.where("subgraph_name", "=", LIVE_SUBGRAPH)
			.execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "=", LIVE_SUBGRAPH)
			.execute();
		await sql`DROP SCHEMA IF EXISTS ${sql.id(
			pgSchemaNameFor("", LIVE_SUBGRAPH),
		)} CASCADE`.execute(db);
	});

	function deployBody(input: {
		name: string;
		source: Record<string, unknown>;
		handlerExpr: string;
		dryRun?: boolean;
	}) {
		const schema = { rows: { columns: { amount: { type: "uint" } } } };
		// Wrapped in defineSubgraph(...) so the AST extractor (f059) can find it —
		// the extractor never executes this, so the identifier need not resolve.
		const handlerCode = [
			"export default defineSubgraph({",
			`  name: ${JSON.stringify(input.name)},`,
			`  sources: { prints: ${JSON.stringify(input.source)} },`,
			`  schema: ${JSON.stringify(schema)},`,
			"  handlers: {",
			"    prints: async (event, ctx) => {",
			`      return ${input.handlerExpr};`,
			"    },",
			"  },",
			"});",
		].join("\n");
		return {
			name: input.name,
			sources: { prints: input.source },
			schema,
			handlerCode,
			...(input.dryRun ? { dryRun: true } : {}),
		};
	}

	async function deploy(body: Record<string, unknown>) {
		return app.request("/subgraphs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	const pinnedSource = {
		type: "print_event",
		contractId: LINT_CONTRACT,
		topic: "completed-deposit",
	};

	test("dry-run deploy surfaces unknown-field warnings", async () => {
		const res = await deploy(
			deployBody({
				name: "print-lint-dryrun-sg",
				source: pinnedSource,
				handlerExpr: "event.data.amount && event.data.bogusField",
				dryRun: true,
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { dryRun: boolean; warnings?: string[] };
		expect(body.dryRun).toBe(true);
		expect(body.warnings).toEqual([
			`print_event source "prints": field "bogusField" never observed on topic(s) completed-deposit of ${LINT_CONTRACT}`,
		]);
	});

	test("dry-run deploy with only observed fields has no warnings", async () => {
		const res = await deploy(
			deployBody({
				name: "print-lint-clean-sg",
				source: pinnedSource,
				handlerExpr: "event.data.amount && event.data.topic",
				dryRun: true,
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { warnings?: string[] };
		expect(body.warnings).toBeUndefined();
	});

	test("trait-scoped print source skips the lint entirely", async () => {
		const res = await deploy(
			deployBody({
				name: "print-lint-trait-sg",
				source: {
					type: "print_event",
					contractId: LINT_CONTRACT,
					trait: "SP2X.some-trait.some-trait",
				},
				handlerExpr: "event.data.totallyBogus",
				dryRun: true,
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { warnings?: string[] };
		expect(body.warnings).toBeUndefined();
	});

	test("real deploy carries warnings on the success body", async () => {
		const res = await deploy(
			deployBody({
				name: LIVE_SUBGRAPH,
				source: pinnedSource,
				handlerExpr: "event.data.bogusField",
			}),
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			action: string;
			warnings?: string[];
		};
		expect(body.action).toBe("created");
		expect(body.warnings).toEqual([
			`print_event source "prints": field "bogusField" never observed on topic(s) completed-deposit of ${LINT_CONTRACT}`,
		]);
	});
});
