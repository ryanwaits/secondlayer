import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-run context propagated through the workflow handler via
 * AsyncLocalStorage. The processor sets this before invoking
 * `def.run(...)` and the AI middleware (`./ai.ts`) reads it to attribute
 * token usage back to the owning account/tenant.
 *
 * `accountId` may be null on unattributed runs (dev scripts, tests).
 * `tenantId` is null for account-scoped workflows like sentries; set
 * for per-tenant workflows.
 */
export interface WorkflowRunAttribution {
	runId: string;
	accountId: string | null;
	tenantId: string | null;
}

export const workflowAls: AsyncLocalStorage<WorkflowRunAttribution> =
	new AsyncLocalStorage<WorkflowRunAttribution>();

export function getCurrentContext(): WorkflowRunAttribution | undefined {
	return workflowAls.getStore();
}
