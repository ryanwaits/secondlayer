import { apiRequest } from "@/lib/api";
import type { ApiKey, SubgraphSummary } from "@/lib/types";
import { createCheckInsights } from "./check-insights";
import { createCheckKeys } from "./check-keys";
import { createCheckSentries } from "./check-sentries";
import { createCheckSubgraphs } from "./check-subgraphs";
import { createCheckUsage } from "./check-usage";
import { deploySubgraph } from "./deploy-subgraph";
import { createDiagnose } from "./diagnose";
import { editSubgraph } from "./edit-subgraph";
import { listSentryKinds } from "./list-sentry-kinds";
import { lookupDocs } from "./lookup-docs";
import { manageKeys } from "./manage-keys";
import { manageSentries } from "./manage-sentries";
import { manageSubgraphs } from "./manage-subgraphs";
import { createQuerySubgraph } from "./query-subgraph";
import { createReadSubgraph } from "./read-subgraph";
import { createRecallSessions } from "./recall-sessions";
import { createScaffoldSubgraph } from "./scaffold-subgraph";
import { showCode } from "./show-code";
import { tailSubgraphSync } from "./tail-subgraph-sync";

export interface AccountResources {
	subgraphs: SubgraphSummary[];
	keys: ApiKey[];
	chainTip: number | null;
}

export async function fetchAccountResources(
	sessionToken: string,
): Promise<AccountResources> {
	const [subgraphs, keys, chainTip] = await Promise.all([
		apiRequest<{ data: SubgraphSummary[] }>("/api/subgraphs", { sessionToken })
			.then((r) => r.data)
			.catch(() => [] as SubgraphSummary[]),
		apiRequest<{ keys: ApiKey[] }>("/api/keys", { sessionToken })
			.then((r) => r.keys)
			.catch(() => [] as ApiKey[]),
		apiRequest<{ chainTip?: number }>("/api/status", { sessionToken })
			.then((r) => r.chainTip ?? null)
			.catch(() => null as number | null),
	]);
	return { subgraphs, keys, chainTip };
}

export function createSessionTools(
	sessionToken: string,
	resources: AccountResources,
) {
	return {
		check_subgraphs: createCheckSubgraphs(sessionToken),
		check_sentries: createCheckSentries(sessionToken),
		check_usage: createCheckUsage(sessionToken),
		check_keys: createCheckKeys(sessionToken),
		check_insights: createCheckInsights(sessionToken),
		query_subgraph: createQuerySubgraph(sessionToken),
		manage_keys: manageKeys,
		manage_subgraphs: manageSubgraphs,
		manage_sentries: manageSentries,
		list_sentry_kinds: listSentryKinds,
		scaffold_subgraph: createScaffoldSubgraph(),
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
