import { describe, expect, test } from "bun:test";
import { matchPatterns } from "../patterns.ts";

describe("matchPatterns", () => {
	test("detects OOM kill", () => {
		const matches = matchPatterns(
			"Killed process 1234 (node) Out of memory",
			"indexer",
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe("oom_kill");
		expect(matches[0].severity).toBe("critical");
		expect(matches[0].action).toBe("restart_service");
	});

	test("detects disk full", () => {
		const matches = matchPatterns(
			"Error: ENOSPC: No space left on device",
			"worker",
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe("disk_full");
		expect(matches[0].action).toBe("prune_docker");
	});

	test("detects connection refused", () => {
		const matches = matchPatterns("connect ECONNREFUSED 127.0.0.1:5432", "api");
		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe("conn_refused");
	});

	test("detects postgres FATAL only for pg services", () => {
		const pgMatches = matchPatterns(
			"FATAL: too many connections for role",
			"postgres",
		);
		expect(pgMatches).toHaveLength(1);
		expect(pgMatches[0].name).toBe("pg_fatal");

		const apiMatches = matchPatterns(
			"FATAL: too many connections for role",
			"api",
		);
		expect(apiMatches).toHaveLength(0);
	});

	test("detects unhandled error", () => {
		const matches = matchPatterns(
			"Unhandled error in request handler: TypeError",
			"api",
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe("unhandled_error");
		expect(matches[0].action).toBe("escalate");
	});

	test("detects backup failure", () => {
		const matches = matchPatterns(
			"pg_dump failed with exit code 1",
			"postgres",
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe("backup_failed");
	});

	test("returns empty for clean logs", () => {
		const matches = matchPatterns(
			"INFO: Block 12345 indexed successfully",
			"indexer",
		);
		expect(matches).toHaveLength(0);
	});

	test("multiple matches on single line", () => {
		const matches = matchPatterns(
			"Out of memory: No space left on device",
			"worker",
		);
		expect(matches.length).toBeGreaterThanOrEqual(2);
		const names = matches.map((m) => m.name);
		expect(names).toContain("oom_kill");
		expect(names).toContain("disk_full");
	});
});
