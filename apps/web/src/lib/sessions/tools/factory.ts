import { apiRequest } from "@/lib/api";
import type { ApiKey, Stream, SubgraphSummary } from "@/lib/types";
import { createCheckStreams } from "./check-streams";
import { createCheckSubgraphs } from "./check-subgraphs";
import { createDiagnose } from "./diagnose";
import { createScaffoldSubgraph } from "./scaffold-subgraph";
import { lookupDocs } from "./lookup-docs";
import { manageStreams } from "./manage-streams";
import { createRecallSessions } from "./recall-sessions";

export interface AccountResources {
	streams: Stream[];
	subgraphs: SubgraphSummary[];
	keys: ApiKey[];
	chainTip: number | null;
}

export async function fetchAccountResources(
	sessionToken: string,
): Promise<AccountResources> {
	const [streams, subgraphs, keys, chainTip] = await Promise.all([
		apiRequest<{ streams: Stream[] }>("/api/streams", { sessionToken })
			.then((r) => r.streams)
			.catch(() => [] as Stream[]),
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
	return { streams, subgraphs, keys, chainTip };
}

export function createSessionTools(sessionToken: string) {
	return {
		check_subgraphs: createCheckSubgraphs(sessionToken),
		check_streams: createCheckStreams(sessionToken),
		manage_streams: manageStreams,
		scaffold_subgraph: createScaffoldSubgraph(),
		lookup_docs: lookupDocs,
		diagnose: createDiagnose(),
		recall_sessions: createRecallSessions(sessionToken),
	};
}
