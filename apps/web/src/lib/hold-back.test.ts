import { describe, expect, test } from "bun:test";
import { createHold } from "./hold-back";

describe("createHold", () => {
	test("begin holds quietly and end releases, bumping the epoch and waking subscribers", () => {
		const hold = createHold();
		let woken = 0;
		hold.subscribe(() => woken++);
		hold.begin();
		expect(hold.active()).toBe(true);
		expect(woken).toBe(0);
		expect(hold.epoch()).toBe(0);
		hold.end();
		expect(hold.active()).toBe(false);
		expect(hold.epoch()).toBe(1);
		expect(woken).toBe(1);
	});

	test("ending a hold that never began still wakes readers once", () => {
		const hold = createHold();
		let woken = 0;
		hold.subscribe(() => woken++);
		hold.end();
		expect(woken).toBe(1);
		expect(hold.active()).toBe(false);
	});

	test("an unsubscribed reader is not woken", () => {
		const hold = createHold();
		let woken = 0;
		const off = hold.subscribe(() => woken++);
		off();
		hold.end();
		expect(woken).toBe(0);
	});
});
