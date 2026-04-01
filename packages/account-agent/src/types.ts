export interface InsightOutput {
	category: "stream" | "key" | "usage" | "subgraph";
	insight_type: string;
	resource_id: string | null;
	severity: "info" | "warning" | "danger";
	title: string;
	body: string;
	data: Record<string, unknown>;
	expires_at: string; // ISO timestamp
}

export interface AgentResult {
	status: "completed" | "failed";
	insights_created: number;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
	error?: string;
}
