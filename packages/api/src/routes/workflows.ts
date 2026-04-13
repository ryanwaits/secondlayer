import { existsSync, mkdirSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getErrorMessage, logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { parseJsonb } from "@secondlayer/shared/db/jsonb";
import {
	bumpPatch,
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
import { streamSSE } from "hono/streaming";
import { getApiKeyId, resolveKeyIds } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";

const MAX_TAIL_DURATION_MS = 30 * 60 * 1000; // 30 minutes (matches logs.ts)
const TAIL_POLL_INTERVAL_MS = 500;

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

const VERSIONED_HANDLER_RE = /^(.+)-(\d+)\.(\d+)\.(\d+)\.js$/;

function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const av = pa[i] ?? 0;
		const bv = pb[i] ?? 0;
		if (av !== bv) return av - bv;
	}
	return 0;
}

/** Keep only the most recent `keep` versions of this workflow's handler bundles. */
async function pruneOlderHandlerVersions(
	dir: string,
	name: string,
	keep: number,
): Promise<void> {
	try {
		const entries = await readdir(dir);
		const versions: Array<{ file: string; version: string }> = [];
		for (const file of entries) {
			const match = file.match(VERSIONED_HANDLER_RE);
			if (!match) continue;
			const [, base, major, minor, patch] = match;
			if (base !== name) continue;
			versions.push({ file, version: `${major}.${minor}.${patch}` });
		}
		versions.sort((x, y) => compareSemver(y.version, x.version));
		const drop = versions.slice(keep);
		for (const v of drop) {
			await unlink(join(dir, v.file)).catch(() => undefined);
		}
	} catch (err) {
		logger.warn("Prune workflow handlers failed", {
			name,
			error: err instanceof Error ? err.message : String(err),
		});
	}
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

	// Resolve the version we're about to write BEFORE the upsert so we can
	// pick a versioned handler path. `bumpPatch` matches the upsert logic —
	// if an edit race lands a different version, the DB write still wins and
	// we reconcile the path after the fact.
	const db = getDb();
	const existing = await getWorkflowDefinition(db, parsed.name, [apiKeyId]);
	const targetVersion = existing ? bumpPatch(existing.version) : "1.0.0";

	const dir = ensureWorkflowDir();
	const handlerPath = join(dir, `${parsed.name}-${targetVersion}.js`);
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

	// If the edit moves this workflow off a schedule trigger, delete any
	// leftover workflow_schedules row so the cron worker stops firing.
	if (triggerType !== "schedule") {
		await db
			.deleteFrom("workflow_schedules")
			.where("definition_id", "=", definition.id)
			.execute();
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

	// If the resolved DB version differs from our pre-bumped prediction
	// (race condition), rename the handler file so the runner can find it.
	if (definition.version !== targetVersion) {
		const actualPath = join(dir, `${parsed.name}-${definition.version}.js`);
		await Bun.write(actualPath, parsed.handlerCode).catch(() => undefined);
		await db
			.updateTable("workflow_definitions")
			.set({ handler_path: actualPath })
			.where("id", "=", definition.id)
			.execute();
		definition.handler_path = actualPath;
	}

	// Prune older versions keeping the last 3 on disk.
	void pruneOlderHandlerVersions(dir, parsed.name, 3);

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

// ── Get source ──────────────────────────────────────────────────────────

app.get("/:name/source", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();
	const def = await getWorkflowDefinition(db, c.req.param("name"), keyIds);

	if (!def) return c.json({ error: "Workflow not found" }, 404);

	if (def.source_code === null) {
		return c.json({
			name: def.name,
			version: def.version,
			sourceCode: null,
			readOnly: true,
			reason: "deployed before source-capture — redeploy to enable chat edits",
			updatedAt: def.updated_at.toISOString(),
		});
	}

	return c.json({
		name: def.name,
		version: def.version,
		sourceCode: def.source_code,
		readOnly: false,
		updatedAt: def.updated_at.toISOString(),
	});
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

// ── Bulk pause ───────────────────────────────────────────────────────────

app.post("/pause-all", async (c) => {
	const keyIds = await resolveKeyIds(c);
	const db = getDb();

	let query = db
		.updateTable("workflow_definitions")
		.set({ status: "paused", updated_at: new Date() })
		.where("status", "=", "active");
	if (keyIds) {
		query = query.where("api_key_id", "in", keyIds);
	}
	const updated = await query.returningAll().execute();

	// Disable any schedule rows for the paused definitions.
	if (updated.length > 0) {
		await db
			.updateTable("workflow_schedules")
			.set({ enabled: false })
			.where(
				"definition_id",
				"in",
				updated.map((d) => d.id),
			)
			.execute();
	}

	return c.json({
		paused: updated.length,
		workflows: updated.map((w) => ({
			name: w.name,
			version: w.version,
			status: w.status,
		})),
	});
});

// ── Cancel run ───────────────────────────────────────────────────────────

app.post("/runs/:runId/cancel", async (c) => {
	const db = getDb();
	const keyIds = await resolveKeyIds(c);
	const runId = c.req.param("runId");

	const run = await getWorkflowRun(db, runId);
	if (!run) return c.json({ error: "Run not found" }, 404);

	// Ownership: the definition must belong to one of the caller's api keys.
	const def = await db
		.selectFrom("workflow_definitions")
		.select(["id", "api_key_id"])
		.where("id", "=", run.definition_id)
		.executeTakeFirst();
	if (!def) return c.json({ error: "Run not found" }, 404);
	if (keyIds && !keyIds.includes(def.api_key_id)) {
		return c.json({ error: "Run not found" }, 404);
	}

	if (run.status !== "running" && run.status !== "pending") {
		return c.json({
			runId,
			status: run.status,
			cancelled: false,
			message: `Run already ${run.status}`,
		});
	}

	const now = new Date();
	await db
		.updateTable("workflow_runs")
		.set({
			status: "cancelled",
			completed_at: now,
			error: "Cancelled by user",
		})
		.where("id", "=", runId)
		.execute();

	// Drop any queue row for this run so workers stop picking it up.
	await db.deleteFrom("workflow_queue").where("run_id", "=", runId).execute();

	return c.json({
		runId,
		status: "cancelled",
		cancelled: true,
		completedAt: now.toISOString(),
	});
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

// ── Rollback ─────────────────────────────────────────────────────────────

app.post("/:name/rollback", async (c) => {
	const apiKeyId = getApiKeyId(c);
	if (!apiKeyId) return c.json({ error: "API key required" }, 401);

	const db = getDb();
	const keyIds = await resolveKeyIds(c);
	const name = c.req.param("name");
	const def = await getWorkflowDefinition(db, name, keyIds);
	if (!def) return c.json({ error: "Workflow not found" }, 404);

	let body: { toVersion?: unknown } = {};
	try {
		body = (await c.req.json()) as { toVersion?: unknown };
	} catch {
		// allow empty body — rollback to previous
	}
	const requestedVersion =
		typeof body.toVersion === "string" ? body.toVersion : undefined;

	const dir = ensureWorkflowDir();
	const availableVersions: string[] = [];
	try {
		const entries = await readdir(dir);
		for (const file of entries) {
			const match = file.match(VERSIONED_HANDLER_RE);
			if (!match) continue;
			const [, base, major, minor, patch] = match;
			if (base !== name) continue;
			availableVersions.push(`${major}.${minor}.${patch}`);
		}
	} catch {
		return c.json(
			{ error: "No prior handler bundles on disk to roll back to." },
			404,
		);
	}
	availableVersions.sort((a, b) => compareSemver(b, a));

	let toVersion: string | undefined;
	if (requestedVersion) {
		if (!availableVersions.includes(requestedVersion)) {
			return c.json(
				{
					error: `Version ${requestedVersion} is not available on disk`,
					available: availableVersions,
				},
				404,
			);
		}
		toVersion = requestedVersion;
	} else {
		toVersion = availableVersions.find((v) => v !== def.version);
		if (!toVersion) {
			return c.json(
				{ error: "No prior version available to roll back to." },
				404,
			);
		}
	}

	// Copy the target handler bundle to the new bumped-version path.
	const nextVersion = bumpPatch(def.version);
	const sourcePath = join(dir, `${name}-${toVersion}.js`);
	const nextPath = join(dir, `${name}-${nextVersion}.js`);
	try {
		const buffer = await Bun.file(sourcePath).arrayBuffer();
		await Bun.write(nextPath, buffer);
	} catch (err) {
		return c.json(
			{ error: `Failed to restore handler: ${getErrorMessage(err)}` },
			500,
		);
	}

	await db
		.updateTable("workflow_definitions")
		.set({
			handler_path: nextPath,
			version: nextVersion,
			status: "active",
			updated_at: new Date(),
		})
		.where("id", "=", def.id)
		.execute();

	void pruneOlderHandlerVersions(dir, name, 3);

	const origin = readOrigin(c);
	logger.info("Workflow rolled back", {
		name,
		fromVersion: def.version,
		toVersion,
		newVersion: nextVersion,
		origin,
	});

	return c.json({
		action: "rolled-back",
		name,
		fromVersion: def.version,
		restoredFromVersion: toVersion,
		version: nextVersion,
	});
});

// ── Tail run (SSE) ───────────────────────────────────────────────────────

app.get("/:name/runs/:runId/stream", async (c) => {
	const db = getDb();
	const keyIds = await resolveKeyIds(c);
	const { name, runId } = c.req.param();

	const def = await getWorkflowDefinition(db, name, keyIds);
	if (!def) return c.json({ error: "Workflow not found" }, 404);

	const run = await getWorkflowRun(db, runId);
	if (!run || run.definition_id !== def.id) {
		return c.json({ error: "Run not found" }, 404);
	}

	return streamSSE(c, async (sseStream) => {
		const seen = new Map<string, string>();
		const startedAt = Date.now();
		let running = true;

		const snapshotSteps = await getWorkflowSteps(db, runId);
		for (const step of snapshotSteps) {
			seen.set(step.id, step.status);
			await sseStream.writeSSE({
				event: "step",
				data: JSON.stringify(serialiseStep(step)),
			});
		}

		if (run.status !== "running" && run.status !== "pending") {
			await sseStream.writeSSE({
				event: "done",
				data: JSON.stringify({ runId, status: run.status }),
			});
			return;
		}

		while (running) {
			if (Date.now() - startedAt > MAX_TAIL_DURATION_MS) {
				await sseStream.writeSSE({
					event: "timeout",
					data: JSON.stringify({
						message: "Stream closed after 30 minutes. Reconnect to continue.",
					}),
				});
				break;
			}

			try {
				const latestRun = await getWorkflowRun(db, runId);
				const steps = await getWorkflowSteps(db, runId);

				for (const step of steps) {
					const prev = seen.get(step.id);
					if (prev !== step.status) {
						seen.set(step.id, step.status);
						await sseStream.writeSSE({
							event: "step",
							data: JSON.stringify(serialiseStep(step)),
						});
					}
				}

				if (
					latestRun &&
					latestRun.status !== "running" &&
					latestRun.status !== "pending"
				) {
					await sseStream.writeSSE({
						event: "done",
						data: JSON.stringify({
							runId,
							status: latestRun.status,
							error: latestRun.error,
							completedAt: latestRun.completed_at?.toISOString() ?? null,
						}),
					});
					break;
				}

				await sseStream.writeSSE({
					event: "heartbeat",
					data: new Date().toISOString(),
				});
				await new Promise((r) => setTimeout(r, TAIL_POLL_INTERVAL_MS));
			} catch (_err) {
				running = false;
			}
		}
	});
});

function serialiseStep(
	step: Awaited<ReturnType<typeof getWorkflowSteps>>[number],
): Record<string, unknown> {
	return {
		id: step.id,
		stepIndex: step.step_index,
		stepId: step.step_id,
		stepType: step.step_type,
		status: step.status,
		output: step.output ? parseJsonb(step.output) : null,
		error: step.error,
		retryCount: step.retry_count,
		aiTokensUsed: step.ai_tokens_used,
		startedAt: step.started_at?.toISOString() ?? null,
		completedAt: step.completed_at?.toISOString() ?? null,
		durationMs: step.duration_ms,
		ts: new Date().toISOString(),
	};
}

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
