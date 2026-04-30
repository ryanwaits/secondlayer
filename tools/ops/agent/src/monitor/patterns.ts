import type { ActionType, PatternMatch, Severity } from "../types.ts";

export interface PatternRule {
	name: string;
	regex: RegExp;
	severity: Severity;
	action: ActionType;
	services?: string[];
	ignore?: (match: RegExpMatchArray, line: string, service: string) => boolean;
	message: (match: RegExpMatchArray, service: string) => string;
}

export const PATTERN_RULES: PatternRule[] = [
	{
		// Kernel OOM-killer signature — anchors on specific phrases the kernel
		// or systemd emits, not the bare token "OOM" which hits too many
		// innocent log lines (e.g. Caddy access logs that happen to contain
		// "BOOM"/"ROOM" or upstream error strings).
		name: "oom_kill",
		regex:
			/(?:Out of memory: Killed process|invoked oom-killer|oom-kill:|Memory cgroup out of memory)/i,
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
		ignore: (m) =>
			/^(?:connection to client lost|terminating connection due to administrator command|canceling authentication due to timeout)$/i.test(
				m[1].trim(),
			),
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
		// Anchors on the literal strings Bun/Node emit when an error escapes
		// the process boundary. The previous broad regex matched any log line
		// containing "unhandled" + "error" (including user prose, auth logs,
		// caddy request strings), which drove false positives.
		name: "unhandled_error",
		regex: /(?:Unhandled error:|uncaught\s+(?:Error|Exception|Rejection)\b)/,
		severity: "error",
		action: "escalate",
		message: (_, svc) => `Unhandled error in ${svc} — escalating to AI`,
	},
	// Note: backup health is covered by the `tenant_backup_stale` anomaly in
	// monitor/tenant-backup-monitor.ts — it scans `$DATA_DIR/backups/tenants/`
	// and alerts when the newest dump for a running tenant is stale. That's a
	// tighter signal than scraping log lines for "backup ... failed", which
	// was prone to false positives (any Caddy log containing those words could
	// match).
];

export function matchPatterns(line: string, service: string): PatternMatch[] {
	const matches: PatternMatch[] = [];

	for (const rule of PATTERN_RULES) {
		if (rule.services && !rule.services.includes(service)) continue;

		const m = line.match(rule.regex);
		if (!m) continue;
		if (rule.ignore?.(m, line, service)) continue;

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
