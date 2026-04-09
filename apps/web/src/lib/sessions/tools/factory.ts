import { apiRequest } from "@/lib/api";
import type {
	ApiKey,
	Stream,
	SubgraphSummary,
	WorkflowSummary,
} from "@/lib/types";
import { createCheckInsights } from "./check-insights";
import { createCheckKeys } from "./check-keys";
import { createCheckStreams } from "./check-streams";
import { createCheckSubgraphs } from "./check-subgraphs";
import { createCheckUsage } from "./check-usage";
import { createCheckWorkflows } from "./check-workflows";
import { createDiagnose } from "./diagnose";
import { lookupDocs } from "./lookup-docs";
import { manageKeys } from "./manage-keys";
import { manageStreams } from "./manage-streams";
import { manageSubgraphs } from "./manage-subgraphs";
import { manageWorkflows } from "./manage-workflows";
import { createQuerySubgraph } from "./query-subgraph";
import { createRecallSessions } from "./recall-sessions";
import { createScaffoldSubgraph } from "./scaffold-subgraph";

export interface AccountResources {
	streams: Stream[];
	subgraphs: SubgraphSummary[];
	workflows: WorkflowSummary[];
	keys: ApiKey[];
	chainTip: number | null;
}

export async function fetchAccountResources(
	sessionToken: string,
): Promise<AccountResources> {
	const [streams, subgraphs, workflows, keys, chainTip] = await Promise.all([
		apiRequest<{ streams: Stream[] }>("/api/streams", { sessionToken })
			.then((r) => r.streams)
			.catch(() => [] as Stream[]),
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
	return { streams, subgraphs, workflows, keys, chainTip };
}

export function createSessionTools(sessionToken: string) {
	return {
		check_subgraphs: createCheckSubgraphs(sessionToken),
		check_streams: createCheckStreams(sessionToken),
		check_usage: createCheckUsage(sessionToken),
		check_keys: createCheckKeys(sessionToken),
		check_insights: createCheckInsights(sessionToken),
		query_subgraph: createQuerySubgraph(sessionToken),
		manage_streams: manageStreams,
		manage_keys: manageKeys,
		manage_subgraphs: manageSubgraphs,
		check_workflows: createCheckWorkflows(sessionToken),
		manage_workflows: manageWorkflows,
		scaffold_subgraph: createScaffoldSubgraph(),
		lookup_docs: lookupDocs,
		diagnose: createDiagnose(),
		recall_sessions: createRecallSessions(sessionToken),
	};
}
