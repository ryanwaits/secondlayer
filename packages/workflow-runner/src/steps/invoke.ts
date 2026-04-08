import type { Kysely } from "kysely";
import type { Database } from "@secondlayer/shared/db";
import type { InvokeOptions } from "@secondlayer/workflows";
import { createWorkflowRun } from "@secondlayer/shared/db/queries/workflows";
import { enqueueWorkflowRun } from "../queue.ts";

/**
 * Invoke another workflow (fire-and-forget).
 * Creates a new run for the target workflow and enqueues it.
 * Returns the new run ID without waiting for completion.
 */
export async function executeInvokeStep(
	db: Kysely<Database>,
	options: InvokeOptions,
): Promise<unknown> {
	// Look up the target workflow definition
	const definition = await db
		.selectFrom("workflow_definitions")
		.selectAll()
		.where("name", "=", options.workflow)
		.where("status", "=", "active")
		.executeTakeFirst();

	if (!definition) {
		throw new Error(
			`Workflow "${options.workflow}" not found or not active`,
		);
	}

	const run = await createWorkflowRun(db, {
		definitionId: definition.id,
		triggerType: "invoke",
		triggerData: (options.input ?? {}) as Record<string, unknown>,
	});

	await enqueueWorkflowRun(run.id);

	return { runId: run.id, workflow: options.workflow };
}
