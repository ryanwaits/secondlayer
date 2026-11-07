import { describe, expect, it } from "bun:test";
import { createCoalescedRunner } from "../src/lib/coalesced-runner";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("coalesced runner", () => {
	it("runs a burst of triggers during one run exactly twice, in order, never overlapping", async () => {
		const gates = [deferred(), deferred()];
		const log: string[] = [];
		let active = 0;
		let maxActive = 0;
		let call = 0;
		const runner = createCoalescedRunner(async () => {
			const n = call++;
			active++;
			maxActive = Math.max(maxActive, active);
			log.push(`start ${n}`);
			await gates[n]?.promise;
			log.push(`end ${n}`);
			active--;
		});

		const first = runner.trigger();
		expect(runner.state()).toBe("deploying");
		await runner.trigger();
		await runner.trigger();
		await runner.trigger();
		expect(runner.state()).toBe("deployingDirty");

		gates[0].resolve();
		await Promise.resolve();
		await Promise.resolve();
		gates[1].resolve();
		await first;

		expect(log).toEqual(["start 0", "end 0", "start 1", "end 1"]);
		expect(maxActive).toBe(1);
		expect(runner.state()).toBe("idle");
	});

	it("a throwing run still returns to idle and allows the next trigger", async () => {
		let calls = 0;
		const runner = createCoalescedRunner(async () => {
			calls++;
			throw new Error("boom");
		});
		await runner.trigger();
		expect(runner.state()).toBe("idle");
		await runner.trigger();
		expect(calls).toBe(2);
	});
});
