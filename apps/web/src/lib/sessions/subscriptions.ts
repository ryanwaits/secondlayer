import { createHmac, randomUUID } from "node:crypto";
import { fetchFromTenantOrThrow } from "@/lib/tenant-api";
import type {
	DeadRow,
	DeliveryRow,
	SubgraphDetail,
	SubscriptionDetail,
	SubscriptionSummary,
} from "@/lib/types";

export interface SubscriptionFinding {
	resource: string;
	resourceType: "subscription";
	severity: "danger" | "warning" | "info";
	title: string;
	description: string;
	suggestion: string;
}

export interface SubscriptionDiagnostics {
	subscription: SubscriptionDetail;
	deliveries: DeliveryRow[];
	deadRows: DeadRow[];
	linkedSubgraph: LinkedSubgraphState | null;
	deliverySummary: {
		total: number;
		successful: number;
		failed: number;
		last: DeliveryRow | null;
	};
	findings: SubscriptionFinding[];
}

export interface LinkedSubgraphState {
	name: string;
	status: string;
	syncStatus: string | null;
	lastProcessedBlock: number | null;
	chainTip: number | null;
	gapCount: number | null;
	integrity: string | null;
}

export interface SignedSubscriptionFixture {
	body: string;
	headers: Record<string, string>;
	curl: string;
}

export async function resolveSubscription(
	sessionToken: string,
	ref: string,
): Promise<SubscriptionDetail> {
	const list = await fetchFromTenantOrThrow<{ data: SubscriptionSummary[] }>(
		sessionToken,
		"/api/subscriptions",
	);
	const exact = list.data.find((sub) => sub.id === ref);
	if (exact) {
		return fetchFromTenantOrThrow<SubscriptionDetail>(
			sessionToken,
			`/api/subscriptions/${exact.id}`,
		);
	}
	const matches = list.data.filter((sub) => sub.name === ref);
	if (matches.length > 1) {
		throw new Error(`Subscription name "${ref}" is ambiguous; use its id.`);
	}
	const id = matches[0]?.id ?? ref;
	return fetchFromTenantOrThrow<SubscriptionDetail>(
		sessionToken,
		`/api/subscriptions/${id}`,
	);
}

export function buildSubscriptionDiagnostics(input: {
	subscription: SubscriptionDetail;
	deliveries: DeliveryRow[];
	deadRows: DeadRow[];
	subgraph?: SubgraphDetail | null;
}): SubscriptionDiagnostics {
	const successful = input.deliveries.filter(isSuccessfulDelivery).length;
	const failed = input.deliveries.length - successful;
	const linkedSubgraph = toLinkedSubgraph(input.subgraph);
	const findings: SubscriptionFinding[] = [];
	const sub = input.subscription;

	if (sub.status === "error") {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "danger",
			title: `${sub.name} is in error`,
			description: sub.lastError ?? "The subscription is marked error.",
			suggestion:
				"Run a signed test fixture against the receiver, then resume.",
		});
	}

	if (sub.status === "paused") {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: sub.circuitOpenedAt ? "danger" : "warning",
			title: sub.circuitOpenedAt ? "Circuit breaker paused delivery" : "Paused",
			description: sub.circuitOpenedAt
				? `Circuit opened at ${sub.circuitOpenedAt}.`
				: "Delivery is paused until resumed.",
			suggestion: "Fix or verify the receiver before resuming delivery.",
		});
	}

	if (sub.lastError && sub.status !== "error") {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "warning",
			title: "Last delivery error recorded",
			description: sub.lastError,
			suggestion: "Inspect recent deliveries and receiver logs.",
		});
	}

	if (failed > 0) {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "warning",
			title: `${failed} recent delivery attempt${failed === 1 ? "" : "s"} failed`,
			description:
				input.deliveries[0]?.errorMessage ??
				`Recent attempts include ${failed} non-2xx response${failed === 1 ? "" : "s"}.`,
			suggestion: "Generate a signed test fixture before retrying delivery.",
		});
	}

	if (input.deadRows.length > 0) {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "danger",
			title: `${input.deadRows.length} dead-letter row${input.deadRows.length === 1 ? "" : "s"}`,
			description:
				"Rows exhausted all retry attempts and need manual recovery.",
			suggestion:
				"Inspect dead rows and requeue selected rows after fixing the receiver.",
		});
	}

	if (linkedSubgraph?.status === "error") {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "danger",
			title: "Linked subgraph is erroring",
			description: `${linkedSubgraph.name} is in error state.`,
			suggestion: "Fix the subgraph before replaying subscription rows.",
		});
	}

	if ((linkedSubgraph?.gapCount ?? 0) > 0) {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "warning",
			title: "Linked subgraph has gaps",
			description: `${linkedSubgraph?.name} reports ${linkedSubgraph?.gapCount} gap${linkedSubgraph?.gapCount === 1 ? "" : "s"}.`,
			suggestion: "Repair subgraph gaps before relying on replay completeness.",
		});
	}

	if (linkedSubgraph?.syncStatus === "catching_up") {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "info",
			title: "Linked subgraph is catching up",
			description: "Matching rows may arrive after the subgraph reaches tip.",
			suggestion: "Wait for sync before judging delivery volume.",
		});
	}

	if (input.deliveries.length === 0) {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "info",
			title: "No deliveries yet",
			description: "No recent delivery attempts were found.",
			suggestion:
				"Confirm the source table has inserted rows matching the filter.",
		});
	}

	if (findings.length === 0) {
		findings.push({
			resource: sub.name,
			resourceType: "subscription",
			severity: "info",
			title: "Subscription looks healthy",
			description: "Recent delivery state has no obvious issue.",
			suggestion: "No recovery action needed.",
		});
	}

	return {
		subscription: sub,
		deliveries: input.deliveries,
		deadRows: input.deadRows,
		linkedSubgraph,
		deliverySummary: {
			total: input.deliveries.length,
			successful,
			failed,
			last: input.deliveries[0] ?? null,
		},
		findings,
	};
}

export function buildSyntheticRow(
	subgraph: SubgraphDetail | null,
	tableName: string,
): Record<string, unknown> {
	const table = subgraph?.tables?.[tableName];
	if (!table) return { id: "example", value: "example" };
	const row: Record<string, unknown> = {};
	for (const [column, definition] of Object.entries(table.columns)) {
		if (column.startsWith("_")) continue;
		row[column] = syntheticValue(definition.type);
	}
	return Object.keys(row).length ? row : { id: "example", value: "example" };
}

export async function representativeSubscriptionRow(
	sessionToken: string,
	subscription: SubscriptionDetail,
	subgraph: SubgraphDetail | null,
): Promise<Record<string, unknown>> {
	const query = new URLSearchParams({
		_limit: "1",
		_sort: "_block_height",
		_order: "desc",
	});
	try {
		const result = await fetchFromTenantOrThrow<{ data: unknown[] }>(
			sessionToken,
			`/api/subgraphs/${subscription.subgraphName}/${subscription.tableName}`,
			{ query },
		);
		const row = result.data[0];
		if (row && typeof row === "object") {
			return row as Record<string, unknown>;
		}
	} catch {}
	return buildSyntheticRow(subgraph, subscription.tableName);
}

export function buildSignedSubscriptionFixture(input: {
	subscription: Pick<
		SubscriptionDetail,
		"id" | "subgraphName" | "tableName" | "url"
	>;
	row: Record<string, unknown>;
	signingSecret: string;
	nowSeconds?: number;
	id?: string;
}): SignedSubscriptionFixture {
	const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
	const body = JSON.stringify({
		type: `${input.subscription.subgraphName}.${input.subscription.tableName}.created`,
		timestamp: new Date(nowSeconds * 1000).toISOString(),
		data: input.row,
	});
	const headers = {
		"content-type": "application/json",
		...signStandardWebhook(body, input.signingSecret, {
			id: input.id ?? `test-${input.subscription.id}`,
			timestampSeconds: nowSeconds,
		}),
	};
	const headerArgs = Object.entries(headers)
		.map(([key, value]) => `  -H ${shellQuote(`${key}: ${value}`)} \\`)
		.join("\n");
	const curl = [
		`curl -X POST ${shellQuote(input.subscription.url)} \\`,
		headerArgs,
		`  --data ${shellQuote(body)}`,
	].join("\n");

	return { body, headers, curl };
}

function isSuccessfulDelivery(row: DeliveryRow): boolean {
	return (
		row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300
	);
}

function toLinkedSubgraph(
	subgraph: SubgraphDetail | null | undefined,
): LinkedSubgraphState | null {
	if (!subgraph) return null;
	const sync = subgraph.sync as SubgraphDetail["sync"] & {
		status?: string;
		gaps?: { count?: number };
		integrity?: string;
	};
	return {
		name: subgraph.name,
		status: subgraph.status,
		syncStatus: sync.status ?? null,
		lastProcessedBlock: subgraph.lastProcessedBlock,
		chainTip: sync.chainTip ?? null,
		gapCount: sync.gaps?.count ?? null,
		integrity: sync.integrity ?? null,
	};
}

function syntheticValue(type: string): unknown {
	switch (type) {
		case "uint":
		case "int":
			return "1000";
		case "boolean":
			return true;
		case "timestamp":
			return new Date(0).toISOString();
		case "jsonb":
			return {};
		case "principal":
			return "SP000000000000000000002Q6VF78";
		default:
			return "example";
	}
}

function signStandardWebhook(
	body: string,
	secret: string,
	options: { id?: string; timestampSeconds?: number } = {},
): Record<string, string> {
	const id = options.id ?? randomUUID();
	const timestamp = String(
		options.timestampSeconds ?? Math.floor(Date.now() / 1000),
	);
	const key = secret.startsWith("whsec_")
		? Buffer.from(secret.slice("whsec_".length), "base64")
		: Buffer.from(secret, "utf8");
	const signature = createHmac("sha256", key)
		.update(`${id}.${timestamp}.${body}`)
		.digest("base64");
	return {
		"webhook-id": id,
		"webhook-timestamp": timestamp,
		"webhook-signature": `v1,${signature}`,
	};
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}
