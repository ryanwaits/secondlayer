import type { SubgraphDetail } from "@secondlayer/shared/schemas/subgraphs";
import type {
	DeadRow,
	DeliveryRow,
	WebhookDetail,
} from "@secondlayer/shared/schemas/webhooks";

/**
 * Webhook diagnosis, shared by `secondlayer webhooks doctor` and the
 * dashboard's webhook detail page. Moved out of the CLI (unchanged behavior)
 * so the web can build the same judgment without printing CLI-command text.
 */

export function isSuccessDelivery(row: DeliveryRow): boolean {
	return (
		row.statusCode !== null && row.statusCode >= 200 && row.statusCode < 300
	);
}

export type DoctorIssueCode =
	| "warning"
	| "paused"
	| "last_error"
	| "circuit"
	| "dead_letters"
	| "subgraph_gaps"
	| "subgraph_catching_up"
	| "no_deliveries";

export interface DoctorIssue {
	code: DoctorIssueCode;
	detail?: string;
}

export interface DoctorReport {
	webhook: WebhookDetail;
	deliverySummary: {
		total: number;
		successful: number;
		failed: number;
		last: DeliveryRow | null;
	};
	deadCount: number;
	subgraph: {
		name: string;
		status: string;
		syncStatus: string;
		lastProcessedBlock: number;
		chainTip: number;
		gapCount: number;
		integrity: string;
	} | null;
	/** CLI-facing next steps, one per issue, in the same order as `issues`. */
	hints: string[];
	issues: DoctorIssue[];
}

export function buildDoctorReport(input: {
	webhook: WebhookDetail;
	deliveries: DeliveryRow[];
	dead: DeadRow[];
	subgraph?: SubgraphDetail | null;
}): DoctorReport {
	const successful = input.deliveries.filter(isSuccessDelivery).length;
	const failed = input.deliveries.length - successful;
	const subgraph = input.subgraph
		? {
				name: input.subgraph.name,
				status: input.subgraph.status,
				syncStatus: input.subgraph.sync.status,
				lastProcessedBlock: input.subgraph.sync.lastProcessedBlock,
				chainTip: input.subgraph.sync.chainTip,
				gapCount: input.subgraph.sync.gaps.count,
				integrity: input.subgraph.sync.integrity,
			}
		: null;

	const hints: string[] = [];
	const issues: DoctorIssue[] = [];
	if (input.webhook.warning) {
		hints.push(input.webhook.warning);
		issues.push({ code: "warning", detail: input.webhook.warning });
	}
	if (input.webhook.status === "paused") {
		hints.push(
			`Resume when the receiver is healthy: secondlayer webhooks resume ${input.webhook.id}`,
		);
		issues.push({ code: "paused" });
	}
	if (input.webhook.lastError) {
		hints.push(
			"Run secondlayer webhooks test to reproduce the receiver request.",
		);
		issues.push({ code: "last_error", detail: input.webhook.lastError });
	}
	if (input.webhook.circuitOpenedAt || input.webhook.circuitFailures > 0) {
		hints.push(
			"Circuit breaker has failures; inspect receiver logs and delivery status codes.",
		);
		issues.push({ code: "circuit" });
	}
	if (input.dead.length > 0) {
		hints.push(
			`Dead-letter rows exist; inspect with secondlayer webhooks dead ${input.webhook.id} and requeue selected rows.`,
		);
		issues.push({ code: "dead_letters" });
	}
	if (subgraph?.gapCount && subgraph.gapCount > 0) {
		hints.push(
			`Linked subgraph has gaps; run secondlayer subgraphs gaps ${input.webhook.subgraphName}.`,
		);
		issues.push({ code: "subgraph_gaps" });
	}
	if (subgraph?.syncStatus === "catching_up") {
		hints.push(
			"Linked subgraph is still catching up; new matching rows may arrive later.",
		);
		issues.push({ code: "subgraph_catching_up" });
	}
	if (input.deliveries.length === 0) {
		hints.push(
			"No deliveries yet; confirm the table is receiving inserted rows that match the filter.",
		);
		issues.push({ code: "no_deliveries" });
	}
	if (hints.length === 0) {
		hints.push("No immediate action needed.");
	}

	return {
		webhook: input.webhook,
		deliverySummary: {
			total: input.deliveries.length,
			successful,
			failed,
			last: input.deliveries[0] ?? null,
		},
		deadCount: input.dead.length,
		subgraph,
		hints,
		issues,
	};
}
