import { afterEach, describe, expect, it } from "bun:test";
import { sandboxEnabled } from "./flag.ts";

/**
 * `sandboxEnabled` truth table — capability (env) AND rollout (row column),
 * never OR. Pure unit test (no DB): `dispatch-dark-wiring.test.ts` already
 * covers the both-off and both-on states end-to-end through real
 * `processBlock` dispatch; this file adds the two mixed states that aren't
 * exercised there (capability on/row off, capability off/row on) plus the
 * both-off/both-on cases at the function level, cheaply.
 */

const prevGlobalFlag = process.env.SUBGRAPH_SANDBOX_WORKERS;

afterEach(() => {
	if (prevGlobalFlag === undefined) delete process.env.SUBGRAPH_SANDBOX_WORKERS;
	else process.env.SUBGRAPH_SANDBOX_WORKERS = prevGlobalFlag;
});

describe("sandboxEnabled — capability AND rollout, not OR", () => {
	it("both on -> true", () => {
		process.env.SUBGRAPH_SANDBOX_WORKERS = "1";
		expect(sandboxEnabled({ sandbox_workers: true })).toBe(true);
	});

	it("capability off, rollout on -> false", () => {
		delete process.env.SUBGRAPH_SANDBOX_WORKERS;
		expect(sandboxEnabled({ sandbox_workers: true })).toBe(false);
	});

	it("capability on, rollout off -> false", () => {
		process.env.SUBGRAPH_SANDBOX_WORKERS = "1";
		expect(sandboxEnabled({ sandbox_workers: false })).toBe(false);
	});

	it("both off -> false", () => {
		delete process.env.SUBGRAPH_SANDBOX_WORKERS;
		expect(sandboxEnabled({ sandbox_workers: false })).toBe(false);
	});

	it('only the literal string "1" counts as capability-on', () => {
		process.env.SUBGRAPH_SANDBOX_WORKERS = "true";
		expect(sandboxEnabled({ sandbox_workers: true })).toBe(false);
	});
});
