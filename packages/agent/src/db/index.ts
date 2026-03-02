import { Database } from "bun:sqlite";

export function initDb(path: string): Database {
  const db = new Database(path, { create: true });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier TEXT NOT NULL,
      trigger_text TEXT NOT NULL,
      analysis TEXT NOT NULL,
      action TEXT NOT NULL,
      service TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT '',
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      disk TEXT NOT NULL DEFAULT '{}',
      mem TEXT NOT NULL DEFAULT '{}',
      gaps TEXT NOT NULL DEFAULT '{}',
      tips TEXT NOT NULL DEFAULT '{}',
      services TEXT NOT NULL DEFAULT '{}',
      queue TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      severity TEXT NOT NULL,
      service TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      slack_ts TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      service TEXT NOT NULL,
      action TEXT NOT NULL,
      last_executed_at TEXT NOT NULL DEFAULT (datetime('now')),
      count_last_hour INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (service, action)
    )
  `);

  return db;
}
