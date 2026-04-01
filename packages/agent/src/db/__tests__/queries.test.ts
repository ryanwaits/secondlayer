import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initDb } from "../index.ts";
import {
	checkCooldown,
	getDailySpend,
	getLatestSnapshot,
	getRecentDecisions,
	getUnresolvedAlertForService,
	insertAlert,
	insertDecision,
	insertSnapshot,
	pruneOldRecords,
	recordCooldown,
	resolveAlert,
	updateAlertSlackTs,
} from "../queries.ts";

let db: Database;

beforeEach(() => {
	db = initDb(":memory:");
});

afterEach(() => {
	db.close();
});

describe("decisions", () => {
	test("insert and retrieve", () => {
		insertDecision(db, {
			tier: "t1_auto",
			trigger: "oom_kill",
			analysis: "OOM in indexer",
			action: "restart_service",
			service: "indexer",
			outcome: "restarted",
			costUsd: 0,
		});

		const decisions = getRecentDecisions(db, 10);
		expect(decisions).toHaveLength(1);
		expect(decisions[0].tier).toBe("t1_auto");
		expect(decisions[0].service).toBe("indexer");
	});
});

describe("snapshots", () => {
	test("insert and get latest", () => {
		insertSnapshot(db, {
			disk: '{"usedPct":45}',
			mem: '{"usedPct":60}',
			gaps: "0",
			tips: '{"indexer":1000}',
			services: '{"indexer":"healthy"}',
			queue: "0",
		});

		const snap = getLatestSnapshot(db);
		expect(snap).not.toBeNull();
		expect(snap!.disk).toBe('{"usedPct":45}');
	});
});

describe("alerts", () => {
	test("insert and resolve", () => {
		const id = insertAlert(db, {
			severity: "error",
			service: "indexer",
			title: "OOM Kill",
			message: "Out of memory in indexer",
		});

		expect(id).toBeGreaterThan(0);

		resolveAlert(db, id);
		const row = db
			.query("SELECT resolved_at FROM alerts WHERE id = ?")
			.get(id) as { resolved_at: string };
		expect(row.resolved_at).not.toBeNull();
	});
});

describe("getUnresolvedAlertForService", () => {
	test("returns unresolved alert with slack_ts", () => {
		const id = insertAlert(db, {
			severity: "error",
			service: "indexer",
			title: "OOM Kill",
			message: "Out of memory",
		});
		updateAlertSlackTs(db, id, "1234567890.123456");

		const alert = getUnresolvedAlertForService(db, "indexer");
		expect(alert).not.toBeNull();
		expect(alert!.id).toBe(id);
		expect(alert!.slackTs).toBe("1234567890.123456");
	});

	test("returns null after resolve", () => {
		const id = insertAlert(db, {
			severity: "error",
			service: "indexer",
			title: "OOM Kill",
			message: "Out of memory",
		});
		updateAlertSlackTs(db, id, "1234567890.123456");

		resolveAlert(db, id);
		expect(getUnresolvedAlertForService(db, "indexer")).toBeNull();
	});

	test("returns null when no slack_ts", () => {
		insertAlert(db, {
			severity: "error",
			service: "indexer",
			title: "OOM Kill",
			message: "Out of memory",
		});
		expect(getUnresolvedAlertForService(db, "indexer")).toBeNull();
	});
});

describe("updateAlertSlackTs", () => {
	test("stores ts on alert", () => {
		const id = insertAlert(db, {
			severity: "warn",
			service: "api",
			title: "Slow",
			message: "API slow",
		});

		updateAlertSlackTs(db, id, "9999.8888");
		const row = db
			.query("SELECT slack_ts FROM alerts WHERE id = ?")
			.get(id) as { slack_ts: string };
		expect(row.slack_ts).toBe("9999.8888");
	});
});

describe("cooldowns", () => {
	test("check and record", () => {
		expect(checkCooldown(db, "indexer", "restart_service", 3)).toBe(false);

		recordCooldown(db, "indexer", "restart_service");
		recordCooldown(db, "indexer", "restart_service");
		recordCooldown(db, "indexer", "restart_service");

		expect(checkCooldown(db, "indexer", "restart_service", 3)).toBe(true);
	});
});

describe("daily spend", () => {
	test("sums cost", () => {
		insertDecision(db, {
			tier: "t2_haiku",
			trigger: "test",
			analysis: "test",
			action: "none",
			service: "indexer",
			outcome: "",
			costUsd: 0.01,
		});
		insertDecision(db, {
			tier: "t2_haiku",
			trigger: "test",
			analysis: "test",
			action: "none",
			service: "api",
			outcome: "",
			costUsd: 0.02,
		});

		expect(getDailySpend(db)).toBe(0.03);
	});
});

describe("prune", () => {
	test("removes old records", () => {
		insertDecision(db, {
			tier: "t1_auto",
			trigger: "test",
			analysis: "test",
			action: "none",
			service: "indexer",
			outcome: "",
			costUsd: 0,
		});
		// Force old timestamp
		db.run("UPDATE decisions SET created_at = datetime('now', '-31 day')");

		pruneOldRecords(db, 30);
		expect(getRecentDecisions(db, 10)).toHaveLength(0);
	});
});
