import { apiRequest } from "@/lib/api";
import type { ApiKey, SubgraphSummary, WorkflowSummary } from "@/lib/types";
import { createCheckInsights } from "./check-insights";
import { createCheckKeys } from "./check-keys";
import { createCheckSubgraphs } from "./check-subgraphs";
import { createCheckUsage } from "./check-usage";
import { createCheckWorkflows } from "./check-workflows";
import { deploySubgraph } from "./deploy-subgraph";
import { deployWorkflow } from "./deploy-workflow";
import { createDiagnose } from "./diagnose";
import { editSubgraph } from "./edit-subgraph";
import { editWorkflow } from "./edit-workflow";
import { lookupDocs } from "./lookup-docs";
import { manageKeys } from "./manage-keys";
import { manageSubgraphs } from "./manage-subgraphs";
import { manageWorkflows } from "./manage-workflows";
import { createQuerySubgraph } from "./query-subgraph";
import { createReadSubgraph } from "./read-subgraph";
import { createReadWorkflow } from "./read-workflow";
import { createRecallSessions } from "./recall-sessions";
import { rollbackWorkflow } from "./rollback-workflow";
import { createScaffoldSubgraph } from "./scaffold-subgraph";
import { createScaffoldWorkflow } from "./scaffold-workflow";
import { showCode } from "./show-code";
import { tailSubgraphSync } from "./tail-subgraph-sync";
import { tailWorkflowRun } from "./tail-workflow-run";

export interface AccountResources {
	subgraphs: SubgraphSummary[];
	workflows: WorkflowSummary[];
	keys: ApiKey[];
	chainTip: number | null;
}

export async function fetchAccountResources(
	sessionToken: string,
): Promise<AccountResources> {
	const [subgraphs, workflows, keys, chainTip] = await Promise.all([
		apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", { sessionToken })
			.then((r) => r.data)
			.catch(() => [] as SubgraphSummary[]),
		apiRequest<{ workflows: WorkflowSummary[] }>("/api/workflows", {
			sessionToken,
		})
			.then((r) => r.workflows)
			.catch(() => [] as WorkflowSummary[]),
		apiRequest<{ keys: ApiKey[] }>("/api/keys", { sessionToken })
			.then((r) => r.keys)
			.catch(() => [] as ApiKey[]),
		apiRequest<{ chainTip?: number }>("/api/status", { sessionToken })
			.then((r) => r.chainTip ?? null)
			.catch(() => null as number | null),
	]);
	return { subgraphs, workflows, keys, chainTip };
}

export function createSessionTools(
	sessionToken: string,
	resources: AccountResources,
) {
	return {
		check_subgraphs: createCheckSubgraphs(sessionToken),
		check_usage: createCheckUsage(sessionToken),
		check_keys: createCheckKeys(sessionToken),
		check_insights: createCheckInsights(sessionToken),
		query_subgraph: createQuerySubgraph(sessionToken),
		manage_keys: manageKeys,
		manage_subgraphs: manageSubgraphs,
		check_workflows: createCheckWorkflows(sessionToken),
		manage_workflows: manageWorkflows,
		scaffold_subgraph: createScaffoldSubgraph(),
		scaffold_workflow: createScaffoldWorkflow(),
		deploy_workflow: deployWorkflow,
		read_workflow: createReadWorkflow(sessionToken),
		edit_workflow: editWorkflow,
		rollback_workflow: rollbackWorkflow,
		tail_workflow_run: tailWorkflowRun,
		deploy_subgraph: deploySubgraph,
		read_subgraph: createReadSubgraph(sessionToken),
		edit_subgraph: editSubgraph,
		tail_subgraph_sync: tailSubgraphSync,
		lookup_docs: lookupDocs,
		diagnose: createDiagnose(resources),
		recall_sessions: createRecallSessions(sessionToken),
		show_code: showCode,
	};
}
