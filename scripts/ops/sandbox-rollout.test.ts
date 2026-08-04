import { afterAll, beforeAll, describe, expect, it } from "bun:test";
/**
 * Report-mode shape, against a seeded local DB. `formatReport` is a pure
 * function (no DB access) so it's testable directly; `fetchSubgraphs` is
 * exercised against the real `subgraphs` table (control-plane, see
 * packages/shared/migrations/0075_restore_subgraphs_on_platform.ts) the same
 * way the manual verification pass in the plan did.
 */
import { randomUUID } from "node:crypto";
import {
	capabilityFlagVisible,
	fetchSubgraphs,
	formatReport,
} from "./sandbox-rollout.ts";

const SKIP = !process.env.DATABASE_URL;
const DB_URL =
	process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || "";

const names: string[] = [];
let db: Bun.SQL;

beforeAll(() => {
	if (SKIP) return;
	db = new Bun.SQL(DB_URL);
});

afterAll(async () => {
	if (SKIP) return;
	for (const name of names) {
		await db`DELETE FROM subgraphs WHERE name = ${name}`;
	}
	await db.close();
});

describe.skipIf(SKIP)("sandbox-rollout report mode", () => {
	it("fetchSubgraphs returns every subgraph with its sandbox_workers value", async () => {
		const a = `sandbox-rollout-test-a-${randomUUID().slice(0, 8)}`;
		const b = `sandbox-rollout-test-b-${randomUUID().slice(0, 8)}`;
		names.push(a, b);
		const accountId = randomUUID();
		await db`
			INSERT INTO subgraphs (name, version, status, definition, schema_hash, handler_path, account_id, sandbox_workers)
			VALUES
				(${a}, '1.0.0', 'active', '{}'::jsonb, 'hash1', 'test', ${accountId}, false),
				(${b}, '1.0.0', 'active', '{}'::jsonb, 'hash2', 'test', ${accountId}, true)
		`;

		const rows = await fetchSubgraphs(db);
		const a_row = rows.find((r) => r.name === a);
		const b_row = rows.find((r) => r.name === b);
		expect(a_row).toEqual({
			name: a,
			sandbox_workers: false,
			status: "active",
		});
		expect(b_row).toEqual({ name: b, sandbox_workers: true, status: "active" });
	});

	it("formatReport renders the capability flag state and one line per subgraph", () => {
		const rows = [
			{ name: "x", sandbox_workers: false, status: "active" },
			{ name: "y", sandbox_workers: true, status: "active" },
		];
		const off = formatReport(rows, false);
		expect(off).toContain("unset (off)");
		expect(off).toContain("x\tsandbox_workers=false\tstatus=active");
		expect(off).toContain("y\tsandbox_workers=true\tstatus=active");

		const on = formatReport(rows, true);
		expect(on).toContain("1 (on");

		expect(formatReport([], false)).toContain("no subgraphs found");
	});

	it("capabilityFlagVisible reflects the env var exactly", () => {
		const prev = process.env.SUBGRAPH_SANDBOX_WORKERS;
		try {
			delete process.env.SUBGRAPH_SANDBOX_WORKERS;
			expect(capabilityFlagVisible()).toBe(false);
			process.env.SUBGRAPH_SANDBOX_WORKERS = "1";
			expect(capabilityFlagVisible()).toBe(true);
			process.env.SUBGRAPH_SANDBOX_WORKERS = "true";
			expect(capabilityFlagVisible()).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.SUBGRAPH_SANDBOX_WORKERS;
			else process.env.SUBGRAPH_SANDBOX_WORKERS = prev;
		}
	});
});
