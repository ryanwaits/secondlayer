import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PatternMatch } from "../types.ts";

/**
 * Tenant-backup freshness monitor.
 *
 * `backup-tenant-pg.sh` runs hourly and writes `<slug>/YYYY-MM-DDTHH-MM-SSZ.dump`.
 * If the newest dump for a tenant is >STALE_MINUTES old, we emit an anomaly
 * so the backup pipeline can't silently rot. Threshold accounts for the
 * hourly cadence + a grace window for long dumps / systemd-timer jitter.
 */

export interface TenantBackupStatus {
	slug: string;
	lastBackupAt: number | null;
	ageMinutes: number | null;
	fileCount: number;
}

const STALE_MINUTES = 90;

export function scanTenantBackups(backupRoot: string): TenantBackupStatus[] {
	let slugs: string[];
	try {
		slugs = readdirSync(backupRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name);
	} catch {
		return [];
	}

	const results: TenantBackupStatus[] = [];
	for (const slug of slugs) {
		const dir = join(backupRoot, slug);
		let dumps: string[];
		try {
			dumps = readdirSync(dir).filter((f) => f.endsWith(".dump"));
		} catch {
			continue;
		}
		if (dumps.length === 0) {
			results.push({
				slug,
				lastBackupAt: null,
				ageMinutes: null,
				fileCount: 0,
			});
			continue;
		}
		let newestMtime = 0;
		for (const f of dumps) {
			try {
				const mtime = statSync(join(dir, f)).mtimeMs;
				if (mtime > newestMtime) newestMtime = mtime;
			} catch {}
		}
		results.push({
			slug,
			lastBackupAt: newestMtime,
			ageMinutes: Math.round((Date.now() - newestMtime) / 60_000),
			fileCount: dumps.length,
		});
	}
	return results;
}

export function detectStaleBackups(
	statuses: TenantBackupStatus[],
	runningSlugs: Set<string>,
): PatternMatch[] {
	const now = Date.now();
	const anomalies: PatternMatch[] = [];
	for (const s of statuses) {
		if (!runningSlugs.has(s.slug)) continue; // tenant stopped; don't page on its backups
		if (s.ageMinutes === null || s.ageMinutes > STALE_MINUTES) {
			anomalies.push({
				name: "tenant_backup_stale",
				severity: s.ageMinutes === null ? "error" : "warn",
				action: "alert_only",
				service: `backup:${s.slug}`,
				message:
					s.ageMinutes === null
						? `No backup has ever completed for tenant ${s.slug}`
						: `Tenant ${s.slug} last backed up ${s.ageMinutes} min ago (threshold ${STALE_MINUTES})`,
				line: "",
				timestamp: now,
			});
		}
	}
	return anomalies;
}
