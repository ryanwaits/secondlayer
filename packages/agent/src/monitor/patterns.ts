import type { ActionType, PatternMatch, Severity } from "../types.ts";

export interface PatternRule {
	name: string;
	regex: RegExp;
	severity: Severity;
	action: ActionType;
	services?: string[];
	message: (match: RegExpMatchArray, service: string) => string;
}

export const PATTERN_RULES: PatternRule[] = [
	{
		name: "oom_kill",
		regex: /(?:Out of memory|OOM|oom-kill|Killed process)/i,
		severity: "critical",
		action: "restart_service",
		message: (_, svc) => `OOM kill detected in ${svc}`,
	},
	{
		name: "disk_full",
		regex: /(?:No space left on device|ENOSPC|disk full)/i,
		severity: "critical",
		action: "prune_docker",
		message: () => "Disk full — pruning docker",
	},
	{
		name: "conn_refused",
		regex: /(?:ECONNREFUSED|Connection refused|connect ECONNREFUSED)/i,
		severity: "warn",
		action: "restart_service",
		message: (_, svc) => `Connection refused in ${svc}`,
	},
	{
		name: "pg_fatal",
		regex: /(?:FATAL|PANIC):\s+(.+)/i,
		severity: "critical",
		action: "alert_only",
		services: ["postgres"],
		message: (m) => `Postgres fatal: ${m[1]}`,
	},
	{
		name: "gap_growth",
		regex: /(?:gap|missing).+?(\d+)\s*(?:blocks?|gaps?)/i,
		severity: "warn",
		action: "alert_only",
		services: ["indexer"],
		message: (m) => `Block gaps detected: ${m[1]}`,
	},
	{
		name: "sync_stall",
		regex: /(?:stall|stuck|timeout).+?(?:sync|block|chain)/i,
		severity: "warn",
		action: "restart_service",
		services: ["indexer"],
		message: (_, svc) => `Sync stall detected in ${svc}`,
	},
	{
		name: "unhandled_error",
		regex: /(?:unhandled|uncaught)\s+(?:error|exception|rejection)/i,
		severity: "error",
		action: "escalate",
		message: (_, svc) => `Unhandled error in ${svc} — escalating to AI`,
	},
	{
		name: "backup_failed",
		regex: /(?:backup|pg_dump|rsync).+?(?:failed|error|FATAL)/i,
		severity: "error",
		action: "alert_only",
		message: () => "Backup failure detected",
	},
];

export function matchPatterns(line: string, service: string): PatternMatch[] {
	const matches: PatternMatch[] = [];

	for (const rule of PATTERN_RULES) {
		if (rule.services && !rule.services.includes(service)) continue;

		const m = line.match(rule.regex);
		if (!m) continue;

		matches.push({
			name: rule.name,
			severity: rule.severity,
			action: rule.action,
			service,
			message: rule.message(m, service),
			line,
			timestamp: Date.now(),
		});
	}

	return matches;
}
