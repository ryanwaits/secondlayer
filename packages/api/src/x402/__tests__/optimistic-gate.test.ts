import { describe, expect, test } from "bun:test";
import {
	InProcOptimisticGate,
	X402_OPTIMISTIC_STRIKE_THRESHOLD,
	X402_OPTIMISTIC_VELOCITY_LIMIT,
} from "../optimistic-gate.ts";

describe("InProcOptimisticGate", () => {
	test("allows optimistic serve under the velocity cap", async () => {
		const gate = new InProcOptimisticGate();
		expect(await gate.canServeOptimistically("SP1")).toBe(true);
		expect(await gate.canServeOptimistically("SP1")).toBe(true);
	});

	test("denies once a principal exceeds the velocity cap (→ confirmed-tier)", async () => {
		const gate = new InProcOptimisticGate();
		for (let i = 0; i < X402_OPTIMISTIC_VELOCITY_LIMIT; i++) {
			expect(await gate.canServeOptimistically("SPbusy")).toBe(true);
		}
		expect(await gate.canServeOptimistically("SPbusy")).toBe(false);
		// a different principal is unaffected
		expect(await gate.canServeOptimistically("SPother")).toBe(true);
	});

	test("strikes ≥ threshold revoke optimism", async () => {
		const gate = new InProcOptimisticGate();
		for (let i = 0; i < X402_OPTIMISTIC_STRIKE_THRESHOLD; i++) {
			await gate.recordStrike("SPdropper");
		}
		expect(await gate.canServeOptimistically("SPdropper")).toBe(false);
	});
});
