import { describe, expect, test } from "bun:test";
import { matchPatterns } from "../patterns.ts";

describe("matchPatterns", () => {
	test("detects OOM kill on kernel-signature log line", () => {
		const matches = matchPatterns(
			"Out of memory: Killed process 1234 (node), UID 1000",
			"indexer",
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe("oom_kill");
		expect(matches[0].severity).toBe("critical");
		expect(matches[0].action).toBe("restart_service");
	});

	test("does NOT fire oom_kill on bare 'OOM' token", () => {
		// A Caddy access log or upstream error that happens to contain "OOM"
		// should not trigger the critical kernel-OOM pattern.
		const matches = matchPatterns(
			'caddy | GET /search?q=OOM 200 "ok"',
			"caddy",
		);
		expect(matches.filter((m) => m.name === "oom_kill")).toHaveLength(0);
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

	test("ignores benign postgres FATAL disconnect/admin lines", () => {
		for (const line of [
			"FATAL: connection to client lost",
			"FATAL: terminating connection due to administrator command",
			"FATAL: canceling authentication due to timeout",
		]) {
			const matches = matchPatterns(line, "postgres");
			expect(matches.filter((m) => m.name === "pg_fatal")).toHaveLength(0);
		}
	});

	test("detects unhandled error on Bun's 'Unhandled error:' literal", () => {
		const matches = matchPatterns(
			"Unhandled error: TypeError: Cannot read property x",
			"api",
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].name).toBe("unhandled_error");
		expect(matches[0].action).toBe("escalate");
	});

	test("detects 'uncaught Error' / 'uncaught Exception' / 'uncaught Rejection'", () => {
		for (const phrase of [
			"uncaught Error: boom",
			"uncaught Exception: x",
			"uncaught Rejection: promise",
		]) {
			const matches = matchPatterns(phrase, "api");
			expect(matches.filter((m) => m.name === "unhandled_error")).toHaveLength(
				1,
			);
		}
	});

	test("does NOT fire unhandled_error on prose containing the words", () => {
		// Tightened regex requires the specific `Unhandled error:` / `uncaught X`
		// tokens — narrative prose or 404 pages that merely mention these words
		// should not trigger the escalation pipeline.
		for (const line of [
			"user reported an unhandled error during signup",
			"404 error: page not found",
			"logging an uncaught error in the background",
			"warn: possibly unhandled exception in downstream call",
		]) {
			const matches = matchPatterns(line, "api");
			expect(matches.filter((m) => m.name === "unhandled_error")).toHaveLength(
				0,
			);
		}
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
			"Out of memory: Killed process 1234. No space left on device",
			"worker",
		);
		expect(matches.length).toBeGreaterThanOrEqual(2);
		const names = matches.map((m) => m.name);
		expect(names).toContain("oom_kill");
		expect(names).toContain("disk_full");
	});
});
