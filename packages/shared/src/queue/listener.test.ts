import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveSourceUrl, resolveTargetUrl } from "../db/index.ts";
import {
	createWakeBus,
	listen,
	notify,
	sourceListenerUrl,
	targetListenerUrl,
} from "./listener.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const CHANNEL = "wake_bus_test_channel";

describe.skipIf(!HAS_DB)("createWakeBus", () => {
	test("every waiter resolves on the next NOTIFY, and gets a fresh promise after", async () => {
		const bus = await createWakeBus(CHANNEL);
		try {
			const first = bus.wait();
			const second = bus.wait();
			await notify(CHANNEL);
			await Promise.all([first, second]);

			// A resolved waiter's slot is gone; a NEW wait() must not resolve until
			// the NEXT notify, proving waiters don't leak across notifications.
			let resolvedEarly = false;
			const third = bus.wait().then(() => {
				resolvedEarly = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(resolvedEarly).toBe(false);

			await notify(CHANNEL);
			await third;
			expect(resolvedEarly).toBe(true);
		} finally {
			await bus.stop();
		}
	});

	test("stop() resolves every pending waiter instead of leaving it hanging", async () => {
		const bus = await createWakeBus(CHANNEL);
		const pending = bus.wait();
		await bus.stop();
		// Must resolve (not hang) even though no NOTIFY ever fired.
		await pending;
	});

	test("generation() starts at 0 and increments once per NOTIFY, independent of how many waiters were pending", async () => {
		const bus = await createWakeBus(CHANNEL);
		try {
			expect(bus.generation()).toBe(0);

			await notify(CHANNEL);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(bus.generation()).toBe(1);

			// No active waiter at all this time — the generation still ticks, so a
			// caller that only checks it later (never having called wait()) can
			// still tell a NOTIFY happened.
			await notify(CHANNEL);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(bus.generation()).toBe(2);
		} finally {
			await bus.stop();
		}
	});
});

describe("createWakeBus degrades safely", () => {
	test("a bad connection string rejects instead of silently no-oping — callers must catch and fall back to polling", async () => {
		await expect(
			createWakeBus(CHANNEL, {
				connectionString: "postgres://bad-host-does-not-resolve:5432/nope",
			}),
		).rejects.toBeTruthy();
	}, 10_000);
});

// Regression coverage for the prod incident where the wake NOTIFYs (plan-063
// Phase 3) never reached their listeners under a real source/target DB split:
// `sourceListenerUrl`/`targetListenerUrl` used to re-derive the env-var
// precedence by hand, skipping the `isPlatformMode()` gate `getSourceDb()`/
// `getTargetDb()` apply — so a process not in platform mode (but with
// `SOURCE_DATABASE_URL`/`TARGET_DATABASE_URL` set anyway, e.g. a shared env
// template) would LISTEN on a different database than the one a write
// through `getSourceDb()` actually committed to and NOTIFYed on.
describe.skipIf(!HAS_DB)("split-DB listener URL resolution", () => {
	// A second, genuinely different database on the same Postgres server —
	// `postgres` always exists — so NOTIFY's per-database isolation is real,
	// not simulated.
	const SOURCE_URL = process.env.DATABASE_URL as string;
	const TARGET_URL = SOURCE_URL.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");

	let prevMode: string | undefined;
	let prevSource: string | undefined;
	let prevTarget: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		prevSource = process.env.SOURCE_DATABASE_URL;
		prevTarget = process.env.TARGET_DATABASE_URL;
	});
	afterEach(() => {
		if (prevMode === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prevMode;
		if (prevSource === undefined) delete process.env.SOURCE_DATABASE_URL;
		else process.env.SOURCE_DATABASE_URL = prevSource;
		if (prevTarget === undefined) delete process.env.TARGET_DATABASE_URL;
		else process.env.TARGET_DATABASE_URL = prevTarget;
	});

	test("in platform mode, sourceListenerUrl()/targetListenerUrl() match resolveSourceUrl()/resolveTargetUrl() exactly — the same function a writer resolves its DB with", () => {
		process.env.INSTANCE_MODE = "platform";
		process.env.SOURCE_DATABASE_URL = SOURCE_URL;
		process.env.TARGET_DATABASE_URL = TARGET_URL;

		expect(sourceListenerUrl()).toBe(resolveSourceUrl());
		expect(targetListenerUrl()).toBe(resolveTargetUrl());
		expect(sourceListenerUrl()).not.toBe(targetListenerUrl());
	});

	test("outside platform mode, both collapse to the single application URL — SOURCE_/TARGET_DATABASE_URL being set must NOT leak through", () => {
		delete process.env.INSTANCE_MODE;
		// A DIFFERENT split pair than DATABASE_URL, so a leak would be
		// observable: if either listener preferred SOURCE_/TARGET_DATABASE_URL
		// despite isPlatformMode() being false, it would resolve to one of
		// these instead of collapsing to the shared application URL.
		process.env.SOURCE_DATABASE_URL = TARGET_URL;
		process.env.TARGET_DATABASE_URL = SOURCE_URL;

		expect(sourceListenerUrl()).toBe(targetListenerUrl());
		expect(sourceListenerUrl()).toBe(resolveSourceUrl());
		// Neither listener picked up the (swapped) split env vars — both would
		// resolve to TARGET_URL here if `sourceListenerUrl()` leaked through.
		expect(sourceListenerUrl()).not.toBe(TARGET_URL);
	});

	test("a NOTIFY committed on the source DB reaches a listener resolved via sourceListenerUrl(), and never one resolved via targetListenerUrl()", async () => {
		process.env.INSTANCE_MODE = "platform";
		process.env.SOURCE_DATABASE_URL = SOURCE_URL;
		process.env.TARGET_DATABASE_URL = TARGET_URL;
		const channel = `split_db_notify_test_${Date.now()}`;
		const sourceEvents: string[] = [];
		const targetEvents: string[] = [];

		const stopSource = await listen(
			channel,
			(p) => {
				if (p) sourceEvents.push(p);
			},
			{ connectionString: sourceListenerUrl() },
		);
		const stopTarget = await listen(
			channel,
			(p) => {
				if (p) targetEvents.push(p);
			},
			{ connectionString: targetListenerUrl() },
		);
		try {
			// Mirrors how a real write resolves its DB: `resolveSourceUrl()`,
			// the same function `getSourceDb()` uses — not a hand-picked URL.
			await notify(channel, "hello-from-source", {
				connectionString: resolveSourceUrl(),
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(sourceEvents).toEqual(["hello-from-source"]);
			expect(targetEvents).toEqual([]);
		} finally {
			await stopSource();
			await stopTarget();
		}
	});
});
