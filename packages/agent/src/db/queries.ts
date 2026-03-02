import type { Database } from "bun:sqlite";
import type { Alert, Decision, Snapshot, Severity, ActionType, Tier } from "../types.ts";

export function insertDecision(
  db: Database,
  d: { tier: Tier; trigger: string; analysis: string; action: ActionType; service: string; outcome: string; costUsd: number }
): void {
  db.run(
    "INSERT INTO decisions (tier, trigger_text, analysis, action, service, outcome, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [d.tier, d.trigger, d.analysis, d.action, d.service, d.outcome, d.costUsd]
  );
}

export function insertSnapshot(
  db: Database,
  s: { disk: string; mem: string; gaps: string; tips: string; services: string; queue: string }
): void {
  db.run(
    "INSERT INTO snapshots (disk, mem, gaps, tips, services, queue) VALUES (?, ?, ?, ?, ?, ?)",
    [s.disk, s.mem, s.gaps, s.tips, s.services, s.queue]
  );
}

export function insertAlert(
  db: Database,
  a: { severity: Severity; service: string; title: string; message: string; slackTs?: string }
): number {
  const result = db.run(
    "INSERT INTO alerts (severity, service, title, message, slack_ts) VALUES (?, ?, ?, ?, ?)",
    [a.severity, a.service, a.title, a.message, a.slackTs ?? null]
  );
  return Number(result.lastInsertRowid);
}

export function resolveAlert(db: Database, id: number): void {
  db.run("UPDATE alerts SET resolved_at = datetime('now') WHERE id = ?", [id]);
}

export function getUnresolvedAlertForService(db: Database, service: string): (Alert & { id: number }) | null {
  return db
    .query(
      "SELECT id, severity, service, title, message, slack_ts as slackTs, resolved_at as resolvedAt, created_at as createdAt FROM alerts WHERE service = ? AND resolved_at IS NULL AND slack_ts IS NOT NULL ORDER BY id DESC LIMIT 1"
    )
    .get(service) as (Alert & { id: number }) | null;
}

export function getAlertById(db: Database, id: number): (Alert & { id: number }) | null {
  return db
    .query(
      "SELECT id, severity, service, title, message, slack_ts as slackTs, resolved_at as resolvedAt, created_at as createdAt FROM alerts WHERE id = ?"
    )
    .get(id) as (Alert & { id: number }) | null;
}

export function updateAlertSlackTs(db: Database, alertId: number, slackTs: string): void {
  db.run("UPDATE alerts SET slack_ts = ? WHERE id = ?", [slackTs, alertId]);
}

export function getRecentDecisions(db: Database, limit = 20): Decision[] {
  return db
    .query(
      "SELECT id, tier, trigger_text as trigger, analysis, action, service, outcome, cost_usd as costUsd, created_at as createdAt FROM decisions ORDER BY id DESC LIMIT ?"
    )
    .all(limit) as Decision[];
}

export function getLatestSnapshot(db: Database): Snapshot | null {
  return (
    db
      .query(
        "SELECT id, disk, mem, gaps, tips, services, queue, created_at as createdAt FROM snapshots ORDER BY id DESC LIMIT 1"
      )
      .get() as Snapshot | null
  );
}

export function checkCooldown(db: Database, service: string, action: string, maxPerHour: number): boolean {
  const row = db
    .query(
      "SELECT count_last_hour FROM cooldowns WHERE service = ? AND action = ? AND last_executed_at > datetime('now', '-1 hour')"
    )
    .get(service, action) as { count_last_hour: number } | null;

  return (row?.count_last_hour ?? 0) >= maxPerHour;
}

export function recordCooldown(db: Database, service: string, action: string): void {
  db.run(
    `INSERT INTO cooldowns (service, action, last_executed_at, count_last_hour)
     VALUES (?, ?, datetime('now'), 1)
     ON CONFLICT(service, action) DO UPDATE SET
       count_last_hour = CASE
         WHEN last_executed_at > datetime('now', '-1 hour') THEN count_last_hour + 1
         ELSE 1
       END,
       last_executed_at = datetime('now')`,
    [service, action]
  );
}

export function getDailySpend(db: Database): number {
  const row = db
    .query("SELECT COALESCE(SUM(cost_usd), 0) as total FROM decisions WHERE created_at > datetime('now', '-1 day')")
    .get() as { total: number };
  return row.total;
}

export function pruneOldRecords(db: Database, retentionDays = 30): void {
  const cutoff = `-${retentionDays} day`;
  db.run("DELETE FROM decisions WHERE created_at < datetime('now', ?)", [cutoff]);
  db.run("DELETE FROM snapshots WHERE created_at < datetime('now', ?)", [cutoff]);
  db.run("DELETE FROM alerts WHERE created_at < datetime('now', ?)", [cutoff]);
  db.run("DELETE FROM cooldowns WHERE last_executed_at < datetime('now', '-1 hour')");
}
