import { describe, expect, test } from "bun:test";
import {
	X402_MIN_FLOOR_USD,
	X402_SPONSORED_TX_BYTES,
	computeGasFloorUsd,
	getX402Price,
	resolvePriceFloorUsd,
} from "../catalog.ts";

describe("x402 price catalog", () => {
	test("surfaces are flat-per-call and offer all three tokens", () => {
		for (const surface of ["streams", "index"] as const) {
			const cfg = getX402Price(surface);
			expect(cfg.priceUsd).toBeGreaterThanOrEqual(X402_MIN_FLOOR_USD);
			expect(cfg.assets).toEqual(["STX", "sBTC", "USDCx"]);
			expect(cfg.maxTimeoutSeconds).toBeGreaterThan(0);
		}
	});

	test("typical gas (STX $0.18, 3 uSTX/byte) is well under a cent", () => {
		const gas = computeGasFloorUsd({
			feeRateUstxPerByte: 3,
			txBytes: X402_SPONSORED_TX_BYTES,
			stxUsd: 0.18,
		});
		expect(gas).toBeLessThan(0.001);
		// floor stays at the $0.001 minimum when gas is cheap
		expect(resolvePriceFloorUsd(gas)).toBe(X402_MIN_FLOOR_USD);
	});

	test("stress market (STX $1.00, 8 uSTX/byte) lifts the floor above gas", () => {
		const gas = computeGasFloorUsd({
			feeRateUstxPerByte: 8,
			txBytes: X402_SPONSORED_TX_BYTES,
			stxUsd: 1.0,
		});
		// 8 * 600 = 4800 uSTX = 0.0048 STX * $1 = $0.0048
		expect(gas).toBeCloseTo(0.0048, 6);
		expect(resolvePriceFloorUsd(gas)).toBe(gas);
		expect(resolvePriceFloorUsd(gas)).toBeGreaterThan(X402_MIN_FLOOR_USD);
	});
});
