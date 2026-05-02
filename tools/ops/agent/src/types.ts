export type Severity = "info" | "warn" | "error" | "critical";

export type Tier = "t1_auto" | "t2_haiku" | "t3_sonnet" | "t4_human";

export type ActionType =
	| "restart_service"
	| "vacuum_postgres"
	| "prune_docker"
	| "clear_docker_logs"
	| "escalate"
	| "alert_only"
	| "none";

export interface HealthStatus {
	indexer: { ok: boolean; lastSeenHeight?: number; error?: string };
	api: { ok: boolean; error?: string };
	stacksNode: {
		ok: boolean;
		tipHeight?: number;
		burnHeight?: number;
		error?: string;
	};
	integrity: {
		ok: boolean;
		gaps?: number;
		totalMissing?: number;
		error?: string;
	};
}

export interface SystemMetrics {
	diskUsedPct: number;
	diskAvailBytes: number;
	memUsedPct: number;
	memAvailBytes: number;
	containers: ContainerStatus[];
	timestamp: number;
}

export interface ContainerStatus {
	name: string;
	cpuPct: number;
	// Raw MiB/GiB numbers parsed out of `docker stats` MemUsage — unit-mixed,
	// reported for display only. Do not use for ratio comparisons; use memPct.
	memUsageMb: number;
	memLimitMb: number;
	/** Pre-computed memory percentage from `docker stats` MemPerc (0–100). */
	memPct: number;
	restartCount: number;
	running: boolean;
	startedAt?: number;
	health?: "healthy" | "unhealthy" | "starting" | "none";
	oomKilled?: boolean;
	exitCode?: number;
}

export interface PatternMatch {
	name: string;
	severity: Severity;
	action: ActionType;
	service: string;
	message: string;
	line: string;
	timestamp: number;
}

export interface Decision {
	id?: number;
	tier: Tier;
	trigger: string;
	analysis: string;
	action: ActionType;
	service: string;
	outcome: string;
	costUsd: number;
	createdAt?: string;
}

export interface Snapshot {
	id?: number;
	disk: string;
	mem: string;
	gaps: string;
	tips: string;
	services: string;
	queue: string;
	createdAt?: string;
}

export interface Alert {
	id?: number;
	severity: Severity;
	service: string;
	title: string;
	message: string;
	slackTs?: string;
	resolvedAt?: string;
	createdAt?: string;
}

export interface HaikuAnalysis {
	severity: Severity;
	diagnosis: string;
	suggestedAction: ActionType | null;
	confidence: number;
	commands?: string[];
}

export interface SonnetDiagnosis {
	severity: Severity;
	diagnosis: string;
	suggestedAction: ActionType | null;
	steps: string[];
	confidence: number;
	commands?: string[];
}
