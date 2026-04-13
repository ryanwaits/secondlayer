import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import {
	createWorkflowRun,
	deleteWorkflowDefinition,
	getWorkflowDefinition,
	getWorkflowRun,
	getWorkflowSteps,
	listWorkflowDefinitions,
	listWorkflowRuns,
	updateWorkflowStatus,
	upsertWorkflowDefinition,
} from "@secondlayer/shared/db/queries/workflows";
import { VersionConflictError } from "@secondlayer/shared/errors";
import { DeployWorkflowRequestSchema } from "@secondlayer/shared/schemas/workflows";
import { Hono } from "hono";
import { getApiKeyId, resolveKeyIds } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const VALID_ORIGINS = new Set(["cli", "mcp", "session"]);
function readOrigin(c: {
	req: { header(name: string): string | undefined };
}): string {
	const raw = c.req.header("x-sl-origin")?.toLowerCase() ?? "unknown";
	return VALID_ORIGINS.has(raw) ? raw : "unknown";
}

const app = new Hono();

const DATA_DIR = process.env.DATA_DIR ?? "./data";

function ensureWorkflowDir(): string {
	const dir = join(DATA_DIR, "workflows");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

// ── Deploy ──────────────────────────────────────────────────────────────

app.post("/", async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new InvalidJSONError();
	}

	const parsed = DeployWorkflowRequestSchema.parse(body);
	const apiKeyId = getApiKeyId(c);
	if (!apiKeyId) return c.json({ error: "API key required" }, 401);

	const bundleSize = Buffer.byteLength(parsed.handlerCode, "utf8");

	// Dry run: validate via data-URI import, no disk write, no DB write.
	if (parsed.dryRun) {
		try {
			const dataUri = `data:text/javascript;base64,${Buffer.from(parsed.handlerCode).toString("base64")}`;
			const mod = await import(dataUri);
			const def = mod.default ?? mod;
			if (!def.trigger || !def.handler) {
				return c.json(
					{
						valid: false,
						error: "Workflow must export trigger and handler",
						bundleSize,
					},
					400,
				);
			}
			return c.json({
				valid: true,
				validation: {
					name: parsed.name,
					triggerType: (parsed.trigger.type as string | undefined) ?? "manual",
				},
				bundleSize,
			});
		} catch (err) {
			return c.json(
				{
					valid: false,
					error: `Invalid handler: ${getErrorMessage(err)}`,
					bundleSize,
				},
				400,
			);
		}
	}

	// Write handler code to disk
	const dir = ensureWorkflowDir();
	const handlerPath = join(dir, `${parsed.name}.js`);
	await Bun.write(handlerPath, parsed.handlerCode);

	// Validate by importing
	try {
		const mod = await import(handlerPath);
		const def = mod.default ?? mod;
		if (!def.trigger || !def.handler) {
			return c.json({ error: "Workflow must export trigger and handler" }, 400);
		}
	} catch (err) {
		return c.json({ error: `Invalid handler: ${getErrorMessage(err)}` }, 400);
	}

	const trigger = parsed.trigger as Record<string, unknown>;
	const triggerType = (trigger.type as string) ?? "manual";

	const db = getDb();
	const origin = readOrigin(c);
	let definition: Awaited<ReturnType<typeof upsertWorkflowDefinition>>;
	try {
		definition = await upsertWorkflowDefinition(db, {
			name: parsed.name,
			triggerType,
			triggerConfig: trigger,
			handlerPath,
			apiKeyId,
			retriesConfig: parsed.retries as Record<string, unknown> | undefined,
			timeoutMs: parsed.timeout,
			sourceCode: parsed.sourceCode,
			expectedVersion: parsed.expectedVersion,
		});
	} catch (err) {
		if (err instanceof VersionConflictError) {
			logger.warn("Workflow deploy version conflict", {
				name: parsed.name,
				origin,
				currentVersion: err.currentVersion,
				expectedVersion: err.expectedVersion,
			});
			return c.json(
				{
					error: err.message,
					code: "VERSION_CONFLICT",
					currentVersion: err.currentVersion,
					expectedVersion: err.expectedVersion,
				},
				409,
			);
		}
		throw err;
	}

	// Handle schedule trigger — upsert workflow_schedules
	if (triggerType === "schedule" && trigger.cron) {
		const { CronExpressionParser } = await import("cron-parser");
		const timezone = (trigger.timezone as string) ?? "UTC";
		const interval = CronExpressionParser.parse(trigger.cron as string, {
			currentDate: new Date(),
			tz: timezone,
		});
		const nextRunAt = interval.next().toDate();

		await db
			.insertInto("workflow_schedules")
			.values({
				definition_id: definition.id,
				cron_expr: trigger.cron as string,
				timezone,
				next_run_at: nextRunAt,
			})
			.onConflict((oc) =>
				oc.column("definition_id").doUpdateSet({
					cron_expr: trigger.cron as string,
					timezone,
					next_run_at: nextRunAt,
					enabled: true,
				}),
			)
			.execute();
	}

	const isNew =
		definition.created_at.getTime() === definition.updated_at.getTime();

	logger.info("Workflow deployed", {
		name: parsed.name,
		version: definition.version,
		action: isNew ? "created" : "updated",
		origin,
		triggerType,
	});

	return c.json({
		action: isNew ? "created" : "updated",
		workflowId: definition.id,
		version: definition.version,
		message: `Workflow "${parsed.name}" ${isNew ? "created" : "updated"}`,
	});
});

// ── List ─────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();
	const definitions = await listWorkflowDefinitions(db, keyIds);

	// Enrich with run counts
	const summaries = await Promise.all(
		definitions.map(async (def) => {
			const runs = await listWorkflowRuns(db, def.id, { limit: 1 });
			const totalRuns = await db
				.selectFrom("workflow_runs")
				.select(db.fn.countAll<number>().as("count"))
				.where("definition_id", "=", def.id)
				.executeTakeFirst();

			return {
				name: def.name,
				version: def.version,
				status: def.status,
				triggerType: def.trigger_type,
				totalRuns: Number(totalRuns?.count ?? 0),
				lastRunAt: runs[0]?.created_at?.toISOString() ?? null,
				createdAt: def.created_at.toISOString(),
				updatedAt: def.updated_at.toISOString(),
			};
		}),
	);

	return c.json({ workflows: summaries });
});

// ── Get ──────────────────────────────────────────────────────────────────

app.get("/:name", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();
	const def = await getWorkflowDefinition(db, c.req.param("name"), keyIds);

	if (!def) return c.json({ error: "Workflow not found" }, 404);

	const totalRuns = await db
		.selectFrom("workflow_runs")
		.select(db.fn.countAll<number>().as("count"))
		.where("definition_id", "=", def.id)
		.executeTakeFirst();

	const lastRun = await db
		.selectFrom("workflow_runs")
		.selectAll()
		.where("definition_id", "=", def.id)
		.orderBy("created_at", "desc")
		.limit(1)
		.executeTakeFirst();

	return c.json({
		name: def.name,
		version: def.version,
		status: def.status,
		triggerType: def.trigger_type,
		triggerConfig: parseJsonb(def.trigger_config),
		retriesConfig: def.retries_config ? parseJsonb(def.retries_config) : null,
		timeoutMs: def.timeout_ms,
		totalRuns: Number(totalRuns?.count ?? 0),
		lastRunAt: lastRun?.created_at?.toISOString() ?? null,
		createdAt: def.created_at.toISOString(),
		updatedAt: def.updated_at.toISOString(),
	});
});

// ── Trigger (manual) ─────────────────────────────────────────────────────

app.post("/:name/trigger", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();
	const def = await getWorkflowDefinition(db, c.req.param("name"), keyIds);

	if (!def) return c.json({ error: "Workflow not found" }, 404);
	if (def.status !== "active")
		return c.json({ error: "Workflow is not active" }, 400);

	let input: Record<string, unknown> = {};
	try {
		const body = await c.req.json();
		input = body?.input ?? {};
	} catch {
		// No body is fine for manual triggers
	}

	const run = await createWorkflowRun(db, {
		definitionId: def.id,
		triggerType: "manual",
		triggerData: input,
	});

	// Enqueue for processing
	await db
		.insertInto("workflow_queue")
		.values({ run_id: run.id, status: "pending" })
		.execute();

	return c.json({ runId: run.id });
});

// ── Pause / Resume ───────────────────────────────────────────────────────

app.post("/:name/pause", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();
	const def = await getWorkflowDefinition(db, c.req.param("name"), keyIds);
	if (!def) return c.json({ error: "Workflow not found" }, 404);

	const apiKeyId = getApiKeyId(c);
	if (!apiKeyId) return c.json({ error: "API key required" }, 401);

	await updateWorkflowStatus(db, def.name, apiKeyId, "paused");

	// Disable schedule if exists
	await db
		.updateTable("workflow_schedules")
		.set({ enabled: false })
		.where("definition_id", "=", def.id)
		.execute();

	return c.json({ ok: true });
});

app.post("/:name/resume", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();
	const def = await getWorkflowDefinition(db, c.req.param("name"), keyIds);
	if (!def) return c.json({ error: "Workflow not found" }, 404);

	const apiKeyId = getApiKeyId(c);
	if (!apiKeyId) return c.json({ error: "API key required" }, 401);

	await updateWorkflowStatus(db, def.name, apiKeyId, "active");

	// Re-enable schedule if exists
	if (def.trigger_type === "schedule") {
		const trigger = parseJsonb<{ cron: string; timezone?: string }>(
			def.trigger_config,
		);
		if (trigger?.cron) {
			const { CronExpressionParser } = await import("cron-parser");
			const timezone = trigger.timezone ?? "UTC";
			const interval = CronExpressionParser.parse(trigger.cron, {
				currentDate: new Date(),
				tz: timezone,
			});

			await db
				.updateTable("workflow_schedules")
				.set({ enabled: true, next_run_at: interval.next().toDate() })
				.where("definition_id", "=", def.id)
				.execute();
		}
	}

	return c.json({ ok: true });
});

// ── Delete ───────────────────────────────────────────────────────────────

app.delete("/:name", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();
	const def = await getWorkflowDefinition(db, c.req.param("name"), keyIds);
	if (!def) return c.json({ error: "Workflow not found" }, 404);

	const apiKeyId = getApiKeyId(c);
	if (!apiKeyId) return c.json({ error: "API key required" }, 401);

	await deleteWorkflowDefinition(db, def.name, apiKeyId);

	// Disable schedule
	await db
		.updateTable("workflow_schedules")
		.set({ enabled: false })
		.where("definition_id", "=", def.id)
		.execute();

	return c.json({ ok: true });
});

// ── List runs ────────────────────────────────────────────────────────────

app.get("/:name/runs", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();
	const def = await getWorkflowDefinition(db, c.req.param("name"), keyIds);
	if (!def) return c.json({ error: "Workflow not found" }, 404);

	const status = c.req.query("status");
	const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);

	const runs = await listWorkflowRuns(db, def.id, {
		status: status || undefined,
		limit,
		offset,
	});

	return c.json({
		runs: runs.map((r) => ({
			id: r.id,
			status: r.status,
			triggerType: r.trigger_type,
			error: r.error,
			startedAt: r.started_at?.toISOString() ?? null,
			completedAt: r.completed_at?.toISOString() ?? null,
			durationMs: r.duration_ms,
			totalAiTokens: r.total_ai_tokens,
			createdAt: r.created_at.toISOString(),
		})),
	});
});

// ── Get run detail ───────────────────────────────────────────────────────

app.get("/runs/:runId", async (c) => {
	const db = getDb();
	const run = await getWorkflowRun(db, c.req.param("runId"));
	if (!run) return c.json({ error: "Run not found" }, 404);

	const steps = await getWorkflowSteps(db, run.id);

	// Verify ownership
	const def = await db
		.selectFrom("workflow_definitions")
		.select(["name", "api_key_id"])
		.where("id", "=", run.definition_id)
		.executeTakeFirst();

	if (def) {
		const keyIds = await resolveKeyIds(c);
		if (keyIds && !keyIds.includes(def.api_key_id)) {
			return c.json({ error: "Run not found" }, 404);
		}
	}

	return c.json({
		id: run.id,
		workflowName: def?.name ?? "unknown",
		status: run.status,
		triggerType: run.trigger_type,
		triggerData: run.trigger_data ? parseJsonb(run.trigger_data) : null,
		error: run.error,
		startedAt: run.started_at?.toISOString() ?? null,
		completedAt: run.completed_at?.toISOString() ?? null,
		durationMs: run.duration_ms,
		totalAiTokens: run.total_ai_tokens,
		createdAt: run.created_at.toISOString(),
		steps: steps.map((s) => ({
			id: s.id,
			stepIndex: s.step_index,
			stepId: s.step_id,
			stepType: s.step_type,
			status: s.status,
			output: s.output ? parseJsonb(s.output) : null,
			error: s.error,
			retryCount: s.retry_count,
			aiTokensUsed: s.ai_tokens_used,
			startedAt: s.started_at?.toISOString() ?? null,
			completedAt: s.completed_at?.toISOString() ?? null,
			durationMs: s.duration_ms,
		})),
	});
});

export default app;
