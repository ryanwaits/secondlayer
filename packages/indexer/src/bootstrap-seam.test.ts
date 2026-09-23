import { describe, expect, test } from "bun:test";
import { planBootstrapSeam } from "./bootstrap-seam.ts";

const event = (
	sequence: string,
	height: number,
	hash: string,
	parentHash: string,
) => ({ sequence, height, hash, parentHash });

describe("bootstrap seam planner", () => {
	test("skips archive duplicates and consumes the live tail", () => {
		const plan = planBootstrapSeam({
			archiveTip: 10,
			archiveTipHash: "h10",
			nodeTip: 12,
			events: [
				event("1", 10, "h10", "h9"),
				event("2", 11, "h11", "h10"),
				event("3", 12, "h12", "h11"),
			],
		});
		expect(plan.status).toBe("ready");
		if (plan.status !== "ready") return;
		expect(plan.skip.map((e) => e.height)).toEqual([10]);
		expect(plan.consume.map((e) => e.height)).toEqual([11, 12]);
		expect(plan.gaps).toEqual([]);
	});

	test("consumes past a gap after the archive tip and names the gap", () => {
		const plan = planBootstrapSeam({
			archiveTip: 10,
			archiveTipHash: "h10",
			nodeTip: 13,
			events: [event("1", 13, "h13", "h12")],
		});
		expect(plan.status).toBe("ready");
		if (plan.status !== "ready") return;
		expect(plan.consume.map((e) => e.height)).toEqual([13]);
		expect(plan.gaps).toEqual([{ from: 11, to: 12 }]);
	});

	test("consumes around a hole inside the journal and names it", () => {
		const plan = planBootstrapSeam({
			archiveTip: 10,
			archiveTipHash: "h10",
			nodeTip: 14,
			events: [event("1", 11, "h11", "h10"), event("2", 14, "h14", "h13")],
		});
		expect(plan.status).toBe("ready");
		if (plan.status !== "ready") return;
		expect(plan.consume.map((e) => e.height)).toEqual([11, 14]);
		expect(plan.gaps).toEqual([{ from: 12, to: 13 }]);
	});

	test("refuses a wrong fork at the archive tip", () => {
		const plan = planBootstrapSeam({
			archiveTip: 10,
			archiveTipHash: "h10",
			nodeTip: 11,
			events: [event("1", 11, "h11", "other")],
		});
		expect(plan.status).toBe("wrong_fork");
		if (plan.status !== "wrong_fork") return;
		expect(plan.expectedParent).toBe("h10");
		expect(plan.got).toBe("other");
	});

	test("refuses a stale archive that the journal does not cover", () => {
		const plan = planBootstrapSeam({
			archiveTip: 10,
			archiveTipHash: "h10",
			nodeTip: 20,
			events: [event("1", 11, "h11", "h10")],
		});
		expect(plan.status).toBe("stale_archive");
		if (plan.status !== "stale_archive") return;
		expect(plan.nodeTip).toBe(20);
		expect(plan.journalTip).toBe(11);
	});
});
