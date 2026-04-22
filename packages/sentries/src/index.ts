import { WorkflowRegistry } from "@secondlayer/workflow-runner";
import { contractDeploymentWorkflow } from "./kinds/contract-deployment.ts";
import { ftOutflowWorkflow } from "./kinds/ft-outflow.ts";
import { largeOutflowWorkflow } from "./kinds/large-outflow.ts";
import { permissionChangeWorkflow } from "./kinds/permission-change.ts";
import { printEventMatchWorkflow } from "./kinds/print-event-match.ts";

export { largeOutflowWorkflow } from "./kinds/large-outflow.ts";
export type { LargeOutflowInput } from "./kinds/large-outflow.ts";
export { permissionChangeWorkflow } from "./kinds/permission-change.ts";
export type { PermissionChangeInput } from "./kinds/permission-change.ts";
export { ftOutflowWorkflow } from "./kinds/ft-outflow.ts";
export type { FtOutflowInput } from "./kinds/ft-outflow.ts";
export { contractDeploymentWorkflow } from "./kinds/contract-deployment.ts";
export type { ContractDeploymentInput } from "./kinds/contract-deployment.ts";
export { printEventMatchWorkflow } from "./kinds/print-event-match.ts";
export type { PrintEventMatchInput } from "./kinds/print-event-match.ts";
export { postToWebhook } from "./delivery.ts";
export type { SlackMessage } from "./types.ts";

/** Build a workflow registry with every sentry kind registered. */
export function buildSentryRegistry(): WorkflowRegistry {
	const registry = new WorkflowRegistry();
	registry.register(largeOutflowWorkflow);
	registry.register(permissionChangeWorkflow);
	registry.register(ftOutflowWorkflow);
	registry.register(contractDeploymentWorkflow);
	registry.register(printEventMatchWorkflow);
	return registry;
}

/** The workflow name for each sentry kind, keyed by the DB `kind` value. */
export const WORKFLOW_NAME_BY_KIND: Record<string, string> = {
	"large-outflow": largeOutflowWorkflow.name,
	"permission-change": permissionChangeWorkflow.name,
	"ft-outflow": ftOutflowWorkflow.name,
	"contract-deployment": contractDeploymentWorkflow.name,
	"print-event-match": printEventMatchWorkflow.name,
};
