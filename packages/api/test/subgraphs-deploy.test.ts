import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractSubgraphDefinition } from "@secondlayer/bundler";
import { getDb } from "@secondlayer/shared/db";
import { pgSchemaName } from "@secondlayer/shared/db/queries/subgraphs";
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
			"empty-mapping-dryrun-sg",
			"empty-mapping-ok-sg",
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
			pgSchemaName(LIVE_SUBGRAPH),
		)} CASCADE`.execute(db);
	});

	function deployBody(input: {
		name: string;
		source: Record<string, unknown>;
		handlerExpr?: string;
		handlerBody?: string;
		dryRun?: boolean;
	}) {
		const schema = { rows: { columns: { amount: { type: "uint" } } } };
		// defineSubgraph stub inlined so import() (empty-mapping probe) resolves —
		// production bundles get the same stub from @secondlayer/bundler.
		const handlerLines = input.handlerBody
			? input.handlerBody
			: `return ${input.handlerExpr ?? "undefined"};`;
		const handlerCode = [
			"function defineSubgraph(def) { return def; }",
			"export default defineSubgraph({",
			`  name: ${JSON.stringify(input.name)},`,
			`  sources: { prints: ${JSON.stringify(input.source)} },`,
			`  schema: ${JSON.stringify(schema)},`,
			"  handlers: {",
			"    prints: async (event, ctx) => {",
			`      ${handlerLines}`,
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
		prints: {
			"completed-deposit": { amount: "uint", bitcoinTxid: "text" },
		},
	};

	test("dry-run deploy refuses unknown fields when prints are declared", async () => {
		const res = await deploy(
			deployBody({
				name: "print-lint-dryrun-sg",
				source: pinnedSource,
				handlerExpr: "event.data.amount && event.data.bogusField",
				dryRun: true,
			}),
		);
		expect(res.status).toBe(422);
		const body = (await res.json()) as { code?: string; error?: string };
		expect(body.code).toBe("PRINT_FIELD_MISMATCH");
		expect(body.error).toContain("bogusField");
	});

	test("dry-run deploy with only observed fields has no warnings", async () => {
		const res = await deploy(
			deployBody({
				name: "print-lint-clean-sg",
				source: pinnedSource,
				handlerBody: "ctx.insert('rows', { amount: event.data.amount });",
				dryRun: true,
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { warnings?: string[]; code?: string };
		expect(body.code).toBeUndefined();
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

	test("real deploy refuses unknown fields when prints are declared", async () => {
		const res = await deploy(
			deployBody({
				name: LIVE_SUBGRAPH,
				source: pinnedSource,
				handlerExpr: "event.data.bogusField",
			}),
		);
		expect(res.status).toBe(422);
		const body = (await res.json()) as { code?: string; error?: string };
		expect(body.code).toBe("PRINT_FIELD_MISMATCH");
		expect(body.error).toContain("bogusField");
	});

	test("dry-run refuses EMPTY_MAPPING when observed keys write 0 rows", async () => {
		// Reads observed `amount` (uint dummy 1n) but only inserts on string —
		// matched > 0, written === 0. Must not hit PRINT_FIELD_MISMATCH first.
		const res = await deploy(
			deployBody({
				name: "empty-mapping-dryrun-sg",
				source: pinnedSource,
				handlerBody: [
					"const v = event.data.amount;",
					'if (typeof v === "string") ctx.insert("rows", { amount: 1n });',
				].join(" "),
				dryRun: true,
			}),
		);
		expect(res.status).toBe(422);
		const body = (await res.json()) as {
			code?: string;
			error?: string;
			firstEventKeys?: string[];
			hint?: string;
		};
		expect(body.code).toBe("EMPTY_MAPPING");
		expect(body.error).toContain("0 rows");
		expect(body.firstEventKeys).toContain("amount");
		expect(body.hint).toContain("subgraphs_test");
	});

	test("dry-run allows handlers that insert observed dummy fields", async () => {
		const res = await deploy(
			deployBody({
				name: "empty-mapping-ok-sg",
				source: pinnedSource,
				handlerBody: "ctx.insert('rows', { amount: event.data.amount });",
				dryRun: true,
			}),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { code?: string; dryRun?: boolean };
		expect(body.code).toBeUndefined();
		expect(body.dryRun).toBe(true);
	});
});

// ── derived verification level + determinism enforcement (route) ────────

describe.skipIf(!HAS_DB)("deploy verification level (route)", () => {
	const VERIFIABLE = "determinism-l2-clean-sg";
	const ADVISORY = "determinism-l3-date-sg";
	const REFUSED = "determinism-l2-date-sg";

	const app = new Hono();
	app.onError(errorHandler);
	app.route("/subgraphs", subgraphsRouter);

	const STATE_SOURCE = {
		type: "map_set",
		contractId: "SP123.vault",
		map: "reserve",
	};
	const EVENT_SOURCE = { type: "stx_transfer" };

	function body(name: string, source: object, handlerBody: string) {
		const schema = { rows: { columns: { amount: { type: "uint" } } } };
		const handlerCode = [
			"function defineSubgraph(def) { return def; }",
			"export default defineSubgraph({",
			`  name: ${JSON.stringify(name)},`,
			"  startBlock: 1,",
			`  sources: { s: ${JSON.stringify(source)} },`,
			`  schema: ${JSON.stringify(schema)},`,
			"  handlers: {",
			"    s: async (event, ctx) => {",
			`      ${handlerBody}`,
			"    },",
			"  },",
			"});",
		].join("\n");
		return { name, sources: { s: source }, schema, handlerCode };
	}

	const post = (b: object) =>
		app.request("/subgraphs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(b),
		});

	afterAll(async () => {
		const db = getDb();
		for (const name of [VERIFIABLE, ADVISORY, REFUSED]) {
			pruneSubgraphHandlerFiles(
				join(process.env.DATA_DIR ?? "./data", "subgraphs"),
				name,
			);
			await db
				.deleteFrom("subgraph_operations")
				.where("subgraph_name", "=", name)
				.execute();
			await db.deleteFrom("subgraphs").where("name", "=", name).execute();
			await sql`DROP SCHEMA IF EXISTS ${sql.id(pgSchemaName(name))} CASCADE`.execute(
				db,
			);
		}
	});

	test("provable sources with Date.now() are refused with the handler position", async () => {
		const res = await post(
			body(
				REFUSED,
				STATE_SOURCE,
				"ctx.insert('rows', { amount: BigInt(Date.now()) });",
			),
		);
		expect(res.status).toBe(422);
		const json = (await res.json()) as {
			code: string;
			verification: { level: string; reasons: string[] };
		};
		expect(json.code).toBe("NONDETERMINISTIC_HANDLER");
		expect(json.verification.level).toBe("state");
		expect(json.verification.reasons).toEqual([
			"handler.js:9:43 Date: wall-clock time differs per run",
		]);
		const db = getDb();
		const row = await db
			.selectFrom("subgraphs")
			.select("id")
			.where("name", "=", REFUSED)
			.executeTakeFirst();
		expect(row).toBeUndefined();
	});

	test("the same handler on unprovable sources deploys as before, with the finding as advice", async () => {
		const res = await post(
			body(
				ADVISORY,
				EVENT_SOURCE,
				"ctx.insert('rows', { amount: BigInt(Date.now()) });",
			),
		);
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			pin: string;
			verification: { level: string; reasons: string[] };
		};
		expect(json.pin).toMatch(/^[0-9a-f]{64}$/);
		expect(json.verification).toMatchObject({
			level: "events",
		});
		expect(json.verification.reasons).toEqual([
			'stx_transfer source "s" needs event proofs',
			"handler.js:9:43 Date: wall-clock time differs per run",
		]);
	});

	test("a clean subgraph on provable sources is state-level with no reasons; detail shows pin and level", async () => {
		const res = await post(
			body(VERIFIABLE, STATE_SOURCE, "ctx.insert('rows', { amount: 1n });"),
		);
		expect(res.status).toBe(201);
		const deployed = (await res.json()) as {
			pin: string;
			verification: { level: string; reasons: string[] };
		};
		expect(deployed.verification).toMatchObject({
			level: "state",
			reasons: [],
		});

		const detail = (await (
			await app.request(`/subgraphs/${VERIFIABLE}`)
		).json()) as { pin: string; schemaHash: string; verification: unknown };
		expect(detail.pin).toBe(deployed.pin);
		expect(detail.pin).not.toBe(detail.schemaHash);
		expect(detail.verification).toEqual(deployed.verification);

		// Same bytes redeployed: unchanged, same pin. A handler edit moves it.
		const again = (await (
			await post(
				body(VERIFIABLE, STATE_SOURCE, "ctx.insert('rows', { amount: 1n });"),
			)
		).json()) as { action: string; pin: string };
		expect(again).toMatchObject({ action: "unchanged", pin: deployed.pin });
		const edited = (await (
			await post(
				body(VERIFIABLE, STATE_SOURCE, "ctx.insert('rows', { amount: 2n });"),
			)
		).json()) as { action: string; pin: string };
		expect(edited.action).toBe("handler_updated");
		expect(edited.pin).not.toBe(deployed.pin);
	});

	test("the source route serves the stored bundle and the preimage its pin hashes, so a client can recompute the pin", async () => {
		const deployedBody = body(
			VERIFIABLE,
			STATE_SOURCE,
			"ctx.insert('rows', { amount: 3n });",
		);
		const deployed = (await (await post(deployedBody)).json()) as {
			pin: string;
		};
		const served = (await (
			await app.request(`/subgraphs/${VERIFIABLE}/source`)
		).json()) as {
			handlerCode: string;
			pin: string;
			pinPreimage: string;
		};
		const sha = (s: string) => createHash("sha256").update(s).digest("hex");
		expect(served.handlerCode).toBe(deployedBody.handlerCode);
		expect(served.pin).toBe(deployed.pin);
		expect(sha(served.pinPreimage)).toBe(served.pin);
		expect(JSON.parse(served.pinPreimage)).toMatchObject({
			handlerHash: sha(deployedBody.handlerCode),
			network: "mainnet",
			startBlock: 1,
		});
	});
});
