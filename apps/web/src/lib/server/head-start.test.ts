import { describe, expect, test } from "bun:test";
import { raceDeadline } from "./head-start";

/** A clock the test moves by hand; a sleep ends when the clock reaches it. */
function fakeClock() {
	let time = 0;
	const sleepers: { at: number; wake: () => void }[] = [];
	return {
		now: () => time,
		sleep(ms: number) {
			let wake = () => {};
			const done = new Promise<void>((resolve) => {
				wake = resolve;
			});
			const entry = { at: time + ms, wake };
			sleepers.push(entry);
			return {
				done,
				cancel: () => {
					sleepers.splice(sleepers.indexOf(entry), 1);
				},
			};
		},
		advance(ms: number) {
			time += ms;
			for (const s of [...sleepers]) if (s.at <= time) s.wake();
		},
		pendingSleeps: () => sleepers.length,
	};
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("raceDeadline", () => {
	test("hands back the value when the read settles inside the budget", async () => {
		const clock = fakeClock();
		const read = deferred<string>();
		const result = raceDeadline(read.promise, 300, clock);
		clock.advance(100);
		read.resolve("data");
		expect(await result).toEqual({ ready: true, value: "data" });
		expect(clock.pendingSleeps()).toBe(0);
	});

	test("hands back the running promise once the budget is spent", async () => {
		const clock = fakeClock();
		const read = deferred<string>();
		const result = raceDeadline(read.promise, 300, clock);
		clock.advance(300);
		const out = await result;
		expect(out.ready).toBe(false);
		read.resolve("late");
		if (!out.ready) expect(await out.pending).toBe("late");
	});

	test("a second call in the same request only gets what the first left", async () => {
		const clock = fakeClock();
		const deadline = 300;
		const first = deferred<string>();
		const second = deferred<string>();
		const a = raceDeadline(first.promise, deadline, clock);
		clock.advance(250);
		first.resolve("a");
		expect((await a).ready).toBe(true);
		const b = raceDeadline(second.promise, deadline, clock);
		clock.advance(50);
		expect((await b).ready).toBe(false);
	});

	test("a spent budget still takes a read that is already settled", async () => {
		const clock = fakeClock();
		clock.advance(500);
		expect(await raceDeadline(Promise.resolve(1), 300, clock)).toEqual({
			ready: true,
			value: 1,
		});
	});
});
