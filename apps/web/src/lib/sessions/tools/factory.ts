import { ApiError, apiRequest } from "@/lib/api";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type { ApiKey, SubgraphSummary, SubscriptionSummary } from "@/lib/types";
import { createCheckInsights } from "./check-insights";
import { createCheckKeys } from "./check-keys";
import { createCheckSubgraphs } from "./check-subgraphs";
import { createCheckSubscriptions } from "./check-subscriptions";
import { createCheckUsage } from "./check-usage";
import { createSubscription } from "./create-subscription";
import { deploySubgraph } from "./deploy-subgraph";
import { createDiagnose } from "./diagnose";
import { createDiagnoseSubscription } from "./diagnose-subscription";
import { editSubgraph } from "./edit-subgraph";
import { lookupDocs } from "./lookup-docs";
import { manageKeys } from "./manage-keys";
import { manageSubgraphs } from "./manage-subgraphs";
import { manageSubscriptions } from "./manage-subscriptions";
import { createQuerySubgraph } from "./query-subgraph";
import { createReadSubgraph } from "./read-subgraph";
import { createRecallSessions } from "./recall-sessions";
import { requeueDeadSubscription } from "./requeue-dead-subscription";
import { createScaffoldSubgraph } from "./scaffold-subgraph";
import { showCode } from "./show-code";
import { tailSubgraphSync } from "./tail-subgraph-sync";
import { createTestSubscription } from "./test-subscription";

export interface AccountResources {
	instance: AccountInstance;
	subgraphs: SubgraphSummary[];
	subscriptions: SubscriptionSummary[];
	keys: ApiKey[];
	chainTip: number | null;
}

export type AccountInstance =
	| {
			exists: true;
			slug: string;
			plan: string;
			status: string;
			apiUrl: string;
	  }
	| { exists: false }
	| { exists: null };

interface TenantSummary {
	slug: string;
	plan: string;
	status: string;
	apiUrl: string;
}

export async function fetchAccountResources(
	sessionToken: string,
): Promise<AccountResources> {
	const [instance, subgraphs, keys, chainTip] = await Promise.all([
		fetchAccountInstance(sessionToken),
		fetchFromTenantOrThrow<{ data: SubgraphSummary[] }>(
			sessionToken,
			"/api/subgraphs",
		)
			.then((r) => r.data)
			.catch(() => [] as SubgraphSummary[]),
		apiRequest<{ keys: ApiKey[] }>("/api/keys", { sessionToken })
			.then((r) => r.keys)
			.catch(() => [] as ApiKey[]),
		apiRequest<{ chainTip?: number }>("/status", { sessionToken })
			.then((r) => r.chainTip ?? null)
			.catch(() => null as number | null),
	]);
	const subscriptions = await fetchFromTenantOrThrow<{
		data: SubscriptionSummary[];
	}>(sessionToken, "/api/subscriptions")
		.then((r) => r.data)
		.catch(() => [] as SubscriptionSummary[]);
	return { instance, subgraphs, subscriptions, keys, chainTip };
}

async function fetchAccountInstance(
	sessionToken: string,
): Promise<AccountInstance> {
	try {
		const data = await apiRequest<{ tenant: TenantSummary }>(
			"/api/tenants/me",
			{ sessionToken, tags: ["tenant"] },
		);
		return {
			exists: true,
			slug: data.tenant.slug,
			plan: data.tenant.plan,
			status: data.tenant.status,
			apiUrl: data.tenant.apiUrl,
		};
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			return { exists: false };
		}
		return { exists: null };
	}
}

export function createSessionTools(
	sessionToken: string,
	resources: AccountResources,
) {
	return {
		check_subgraphs: createCheckSubgraphs(sessionToken, resources.instance),
		check_subscriptions: createCheckSubscriptions(
			sessionToken,
			resources.instance,
		),
		check_usage: createCheckUsage(sessionToken),
		check_keys: createCheckKeys(sessionToken),
		check_insights: createCheckInsights(sessionToken),
		query_subgraph: createQuerySubgraph(sessionToken),
		manage_keys: manageKeys,
		manage_subgraphs: manageSubgraphs,
		create_subscription: createSubscription,
		manage_subscriptions: manageSubscriptions,
		diagnose_subscription: createDiagnoseSubscription(sessionToken),
		test_subscription: createTestSubscription(sessionToken),
		requeue_dead_subscription: requeueDeadSubscription,
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
