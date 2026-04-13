import type { Kysely } from "kysely";
import { VersionConflictError } from "../../errors.ts";
import { jsonb } from "../jsonb.ts";
import type {
	Database,
	WorkflowDefinition,
	WorkflowRun,
	WorkflowStep,
} from "../types.ts";

/** Bump the patch digit of a semver string. Falls back to "1.0.1" on malformed input. */
export function bumpPatch(version: string): string {
	const parts = version.split(".");
	if (parts.length !== 3) return "1.0.1";
	const [major, minor, patch] = parts.map((p) => Number.parseInt(p, 10));
	if (
		Number.isNaN(major) ||
		Number.isNaN(minor) ||
		Number.isNaN(patch) ||
		major === undefined ||
		minor === undefined ||
		patch === undefined
	) {
		return "1.0.1";
	}
	return `${major}.${minor}.${patch + 1}`;
}

// ── Definitions ──────────────────────────────────────────────────────

export async function listWorkflowDefinitions(
	db: Kysely<Database>,
	apiKeyIds?: string[],
): Promise<WorkflowDefinition[]> {
	let query = db
		.selectFrom("workflow_definitions")
		.selectAll()
		.where("status", "!=", "deleted")
		.orderBy("created_at", "desc");

	if (apiKeyIds?.length) {
		query = query.where("api_key_id", "in", apiKeyIds);
	}

	return await query.execute();
}

export async function getWorkflowDefinition(
	db: Kysely<Database>,
	name: string,
	apiKeyIds?: string[],
): Promise<WorkflowDefinition | null> {
	let query = db
		.selectFrom("workflow_definitions")
		.selectAll()
		.where("name", "=", name);

	if (apiKeyIds?.length) {
		query = query.where("api_key_id", "in", apiKeyIds);
	}

	return (await query.executeTakeFirst()) ?? null;
}

export async function upsertWorkflowDefinition(
	db: Kysely<Database>,
	data: {
		name: string;
		triggerType: string;
		triggerConfig: Record<string, unknown>;
		handlerPath: string;
		apiKeyId: string;
		projectId?: string;
		retriesConfig?: Record<string, unknown>;
		timeoutMs?: number;
		sourceCode?: string;
		expectedVersion?: string;
	},
): Promise<WorkflowDefinition> {
	const existing = await db
		.selectFrom("workflow_definitions")
		.selectAll()
		.where("name", "=", data.name)
		.where("api_key_id", "=", data.apiKeyId)
		.executeTakeFirst();

	if (existing) {
		if (
			data.expectedVersion !== undefined &&
			existing.version !== data.expectedVersion
		) {
			throw new VersionConflictError(existing.version, data.expectedVersion);
		}

		const nextVersion = bumpPatch(existing.version);

		return await db
			.updateTable("workflow_definitions")
			.set({
				trigger_type: data.triggerType,
				trigger_config: jsonb(data.triggerConfig) as unknown as string,
				handler_path: data.handlerPath,
				source_code: data.sourceCode ?? existing.source_code,
				retries_config: data.retriesConfig
					? (jsonb(data.retriesConfig) as unknown as string)
					: null,
				timeout_ms: data.timeoutMs ?? null,
				version: nextVersion,
				status: "active",
				updated_at: new Date(),
			})
			.where("id", "=", existing.id)
			.returningAll()
			.executeTakeFirstOrThrow();
	}

	return await db
		.insertInto("workflow_definitions")
		.values({
			name: data.name,
			trigger_type: data.triggerType,
			trigger_config: jsonb(data.triggerConfig) as unknown as string,
			handler_path: data.handlerPath,
			source_code: data.sourceCode ?? null,
			api_key_id: data.apiKeyId,
			project_id: data.projectId ?? null,
			retries_config: data.retriesConfig
				? (jsonb(data.retriesConfig) as unknown as string)
				: null,
			timeout_ms: data.timeoutMs ?? null,
			version: "1.0.0",
		})
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function updateWorkflowStatus(
	db: Kysely<Database>,
	name: string,
	apiKeyId: string,
	status: string,
): Promise<void> {
	await db
		.updateTable("workflow_definitions")
		.set({ status, updated_at: new Date() })
		.where("name", "=", name)
		.where("api_key_id", "=", apiKeyId)
		.execute();
}

export async function deleteWorkflowDefinition(
	db: Kysely<Database>,
	name: string,
	apiKeyId: string,
): Promise<void> {
	await db
		.updateTable("workflow_definitions")
		.set({ status: "deleted", updated_at: new Date() })
		.where("name", "=", name)
		.where("api_key_id", "=", apiKeyId)
		.execute();
}

// ── Runs ─────────────────────────────────────────────────────────────

export async function createWorkflowRun(
	db: Kysely<Database>,
	data: {
		definitionId: string;
		triggerType: string;
		triggerData?: Record<string, unknown>;
		dedupKey?: string;
	},
): Promise<WorkflowRun> {
	return await db
		.insertInto("workflow_runs")
		.values({
			definition_id: data.definitionId,
			trigger_type: data.triggerType,
			trigger_data: data.triggerData
				? (jsonb(data.triggerData) as unknown as string)
				: null,
			dedup_key: data.dedupKey ?? null,
		})
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function getWorkflowRun(
	db: Kysely<Database>,
	runId: string,
): Promise<WorkflowRun | null> {
	return (
		(await db
			.selectFrom("workflow_runs")
			.selectAll()
			.where("id", "=", runId)
			.executeTakeFirst()) ?? null
	);
}

export async function listWorkflowRuns(
	db: Kysely<Database>,
	definitionId: string,
	params?: { status?: string; limit?: number; offset?: number },
): Promise<WorkflowRun[]> {
	let query = db
		.selectFrom("workflow_runs")
		.selectAll()
		.where("definition_id", "=", definitionId)
		.orderBy("created_at", "desc");

	if (params?.status) {
		query = query.where("status", "=", params.status);
	}

	query = query.limit(params?.limit ?? 20);

	if (params?.offset) {
		query = query.offset(params.offset);
	}

	return await query.execute();
}

// ── Steps ────────────────────────────────────────────────────────────

export async function getWorkflowSteps(
	db: Kysely<Database>,
	runId: string,
): Promise<WorkflowStep[]> {
	return await db
		.selectFrom("workflow_steps")
		.selectAll()
		.where("run_id", "=", runId)
		.orderBy("step_index", "asc")
		.execute();
}
