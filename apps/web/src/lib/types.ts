export interface Account {
	id: string;
	email: string;
	plan: string;
	displayName: string | null;
	bio: string | null;
	slug: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

export interface ApiKey {
	id: string;
	prefix: string;
	name: string;
	status: string;
	createdAt: string;
	lastUsedAt: string | null;
}

export interface SubgraphSummary {
	name: string;
	version: string;
	status: string;
	lastProcessedBlock: number | null;
	totalProcessed: number;
	totalRows?: number;
	totalErrors: number;
	tables: string[];
	createdAt: string;
}

export interface AccountInsight {
	id: string;
	category: string;
	insightType: string;
	resourceId: string | null;
	severity: "info" | "warning" | "danger";
	title: string;
	body: string;
	data: Record<string, unknown>;
	createdAt: string;
	expiresAt: string | null;
}

export interface Project {
	id: string;
	name: string;
	slug: string;
	network: string;
	nodeRpc: string | null;
	settings: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface TeamMember {
	id: string;
	role: string;
	email: string;
	displayName: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

export interface TeamInvitation {
	id: string;
	email: string;
	role: string;
	expiresAt: string;
	createdAt: string;
}

export interface SystemStatus {
	status: "healthy" | "degraded";
	chainTip: number | null;
	recentDeliveries: number;
	timestamp: string;
}

export interface WorkflowSummary {
	name: string;
	version: number;
	status: "active" | "paused";
	triggerType: string;
	totalRuns: number;
	lastRunAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface WorkflowDetail extends WorkflowSummary {
	triggerConfig: Record<string, unknown>;
	retriesConfig: Record<string, unknown> | null;
	timeoutMs: number | null;
}

export interface WorkflowRun {
	id: string;
	status: string;
	triggerType: string;
	error: string | null;
	startedAt: string | null;
	completedAt: string | null;
	durationMs: number | null;
	totalAiTokens: number | null;
	createdAt: string;
}

export interface WorkflowStep {
	id: string;
	stepIndex: number;
	stepId: string;
	stepType: string;
	status: string;
	output: unknown;
	error: string | null;
	retryCount: number;
	aiTokensUsed: number | null;
	startedAt: string | null;
	completedAt: string | null;
	durationMs: number | null;
}

export interface WorkflowRunDetail extends WorkflowRun {
	workflowName: string;
	triggerData: unknown;
	steps: WorkflowStep[];
}

// ── Admin ──

export interface WaitlistEntry {
	id: string;
	email: string;
	source: string;
	status: "pending" | "approved" | "joined";
	createdAt: string;
}

export interface AdminAccount {
	id: string;
	email: string;
	plan: string;
	createdAt: string;
	subgraphCount: number;
	lastActive: string | null;
}

export interface AdminStats {
	totalAccounts: number;
	pendingWaitlist: number;
	totalSubgraphs: number;
	activeSubgraphs: number;
	errorSubgraphs: number;
}

export interface SubgraphFilter {
	type: string;
	[key: string]: unknown;
}

export interface SubgraphDetail {
	name: string;
	version: string;
	status: string;
	lastProcessedBlock: number | null;
	description?: string;
	sources?: Record<string, SubgraphFilter>;
	definition?: Record<string, unknown>;
	health: {
		totalProcessed: number;
		totalErrors: number;
		errorRate: number;
		lastError: string | null;
		lastErrorAt: string | null;
	};
	sync: {
		blocksRemaining: number;
		chainTip: number | null;
		progress: number;
	};
	tables: Record<
		string,
		{
			rowCount: number;
			endpoint: string;
			columns: Record<
				string,
				{
					type: string;
					nullable?: boolean;
					indexed?: boolean;
					searchable?: boolean;
					default?: string | number | boolean;
				}
			>;
			indexes?: string[][];
			uniqueKeys?: string[][];
			example: unknown;
		}
	>;
	createdAt: string;
	updatedAt: string;
}
