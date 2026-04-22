import { WorkflowRegistry } from "@secondlayer/workflow-runner";
import { largeOutflowWorkflow } from "./kinds/large-outflow.ts";
import { permissionChangeWorkflow } from "./kinds/permission-change.ts";

export { largeOutflowWorkflow } from "./kinds/large-outflow.ts";
export type { LargeOutflowInput } from "./kinds/large-outflow.ts";
export { permissionChangeWorkflow } from "./kinds/permission-change.ts";
export type { PermissionChangeInput } from "./kinds/permission-change.ts";
export { postToWebhook } from "./delivery.ts";
export type { SlackMessage } from "./types.ts";

/** Build a workflow registry with every sentry kind registered. */
export function buildSentryRegistry(): WorkflowRegistry {
	const registry = new WorkflowRegistry();
	registry.register(largeOutflowWorkflow);
	registry.register(permissionChangeWorkflow);
	return registry;
}

/** The workflow name for each sentry kind, keyed by the DB `kind` value. */
export const WORKFLOW_NAME_BY_KIND: Record<string, string> = {
	"large-outflow": largeOutflowWorkflow.name,
	"permission-change": permissionChangeWorkflow.name,
};
