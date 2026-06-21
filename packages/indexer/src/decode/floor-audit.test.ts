import { describe, expect, test } from "bun:test";
import {
	DECODER_FLOOR_BASELINE,
	FLOOR_TOLERANCE,
	auditFloors,
} from "./floor-audit.ts";

const baseline = { "decode.x.v1": 100, "decode.y.v1": 50_000 };

describe("auditFloors", () => {
	test("floor at baseline is ok", () => {
		const a = auditFloors([{ decoder: "decode.x.v1", floor: 100 }], {
			baseline,
			tolerance: 1000,
		});
		expect(a.ok).toBe(true);
		expect(a.decoders[0].status).toBe("ok");
	});

	test("floor below baseline is ok (more history than expected)", () => {
		const a = auditFloors([{ decoder: "decode.x.v1", floor: 1 }], {
			baseline,
			tolerance: 1000,
		});
		expect(a.ok).toBe(true);
		expect(a.decoders[0].status).toBe("ok");
	});

	test("floor within tolerance is ok (absorbs near-floor reorg shift)", () => {
		const a = auditFloors([{ decoder: "decode.x.v1", floor: 100 + 999 }], {
			baseline,
			tolerance: 1000,
		});
		expect(a.decoders[0].status).toBe("ok");
	});

	test("floor above ceiling is floored — the ~6.8M go-forward regression", () => {
		const a = auditFloors([{ decoder: "decode.x.v1", floor: 6_800_000 }], {
			baseline,
			tolerance: 1000,
		});
		expect(a.ok).toBe(false);
		expect(a.decoders[0].status).toBe("floored");
		expect(a.floored.map((d) => d.decoder)).toEqual(["decode.x.v1"]);
	});

	test("enabled decoder with no baseline is unbaselined — the forcing function", () => {
		const a = auditFloors([{ decoder: "decode.new.v1", floor: 5 }], {
			baseline,
			tolerance: 1000,
		});
		expect(a.ok).toBe(false);
		expect(a.decoders[0].status).toBe("unbaselined");
		expect(a.unbaselined.map((d) => d.decoder)).toEqual(["decode.new.v1"]);
	});

	test("no rows yet is empty, not a failure", () => {
		const a = auditFloors([{ decoder: "decode.x.v1", floor: null }], {
			baseline,
			tolerance: 1000,
		});
		expect(a.ok).toBe(true);
		expect(a.decoders[0].status).toBe("empty");
	});

	test("mixed set: one floored fails the whole audit, others classified", () => {
		const a = auditFloors(
			[
				{ decoder: "decode.x.v1", floor: 100 },
				{ decoder: "decode.y.v1", floor: 9_000_000 },
				{ decoder: "decode.z.v1", floor: 5 },
			],
			{ baseline, tolerance: 1000 },
		);
		expect(a.ok).toBe(false);
		expect(a.floored.map((d) => d.decoder)).toEqual(["decode.y.v1"]);
		expect(a.unbaselined.map((d) => d.decoder)).toEqual(["decode.z.v1"]);
	});

	test("dedicated decoders floor at contract-deploy height, not genesis", () => {
		// sBTC/pox-4/BNS legitimately start thousands of blocks in — the per-decoder
		// baseline must not flag them as floored against a block-1 expectation.
		const a = auditFloors(
			[
				{ decoder: "decode.sbtc.v1", floor: 328312 },
				{ decoder: "decode.pox4.v1", floor: 147294 },
				{ decoder: "decode.bns.v1", floor: 167540 },
			],
			// real baseline + tolerance
		);
		expect(a.ok).toBe(true);
		expect(a.decoders.every((d) => d.status === "ok")).toBe(true);
	});

	test("real baseline catches a floored real decoder", () => {
		// stx_transfer's known floor is 10; a 6.8M floor (its pre-Sprint-B state)
		// must trip the guard under the shipped baseline + tolerance.
		const a = auditFloors([
			{ decoder: "decode.stx_transfer.v1", floor: 6_800_000 },
		]);
		expect(a.ok).toBe(false);
		expect(a.floored[0].decoder).toBe("decode.stx_transfer.v1");
		expect(a.floored[0].ceiling).toBe(
			DECODER_FLOOR_BASELINE["decode.stx_transfer.v1"] + FLOOR_TOLERANCE,
		);
	});
});
