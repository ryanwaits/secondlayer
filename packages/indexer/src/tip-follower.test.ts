import { beforeEach, describe, expect, test } from "bun:test";
import type { NodeInfo } from "@secondlayer/shared/node/client";
import type { ReplayBlockPayload } from "@secondlayer/shared/node/local-client";
import {
	type TipFollowerDeps,
	createTipFollowerTick,
	recordBlockReceived,
	tipFollowerState,
} from "./tip-follower.ts";

const NOW = 1_000_000_000;
const TIMEOUT_SEC = 60;

interface Fake {
	deps: TipFollowerDeps;
	ingested: number[];
	replayRequests: number[];
	nodeCalls: number;
	localClients: number;
}

function fakeDeps(opts: {
	chainTip: number;
	ourHeight: number;
	healthy?: () => Promise<boolean>;
	onIngest?: (height: number) => void;
}): Fake {
	const fake: Fake = {
		deps: undefined as unknown as TipFollowerDeps,
		ingested: [],
		replayRequests: [],
		nodeCalls: 0,
		localClients: 0,
	};
	fake.deps = {
		timeoutSec: TIMEOUT_SEC,
		now: () => NOW,
		createNode: () => {
			fake.nodeCalls++;
			return {
				isHealthy: opts.healthy ?? (async () => true),
				getInfo: async () =>
					({ stacks_tip_height: opts.chainTip }) as unknown as NodeInfo,
			};
		},
		getDb: () => ({}) as ReturnType<TipFollowerDeps["getDb"]>,
		resolveOurHeight: async () => opts.ourHeight,
		createLocalClient: () => {
			fake.localClients++;
			return {
				getBlockForReplay: async (_db, height) => {
					fake.replayRequests.push(height);
					return { block_height: height } as unknown as ReplayBlockPayload;
				},
			};
		},
		ingest: async (payload) => {
			const height = (payload as unknown as { block_height: number })
				.block_height;
			opts.onIngest?.(height);
			fake.ingested.push(height);
		},
	};
	return fake;
}

beforeEach(() => {
	tipFollowerState.mode = "normal";
	tipFollowerState.lastBlockReceivedAt = NOW;
	tipFollowerState.blocksFetchedViaPoll = 0;
});

describe("tip follower tick", () => {
	test("silence below the timeout is a no-op and stays normal", async () => {
		tipFollowerState.lastBlockReceivedAt = NOW - (TIMEOUT_SEC * 1000 - 1);
		const fake = fakeDeps({ chainTip: 105, ourHeight: 100 });

		await createTipFollowerTick(fake.deps)();

		expect(tipFollowerState.mode).toBe("normal");
		expect(fake.nodeCalls).toBe(0);
		expect(fake.ingested).toEqual([]);
	});

	test("silence past the timeout switches to polling and replays a small gap", async () => {
		tipFollowerState.lastBlockReceivedAt = NOW - TIMEOUT_SEC * 1000;
		const fake = fakeDeps({ chainTip: 103, ourHeight: 100 });

		await createTipFollowerTick(fake.deps)();

		expect(tipFollowerState.mode).toBe("polling");
		expect(fake.ingested).toEqual([101, 102, 103]);
		expect(tipFollowerState.blocksFetchedViaPoll).toBe(3);
	});

	test("a gap over 10 blocks skips the replay loop", async () => {
		tipFollowerState.lastBlockReceivedAt = NOW - TIMEOUT_SEC * 1000;
		const fake = fakeDeps({ chainTip: 111, ourHeight: 100 });

		await createTipFollowerTick(fake.deps)();

		expect(tipFollowerState.mode).toBe("polling");
		expect(fake.localClients).toBe(0);
		expect(fake.replayRequests).toEqual([]);
		expect(tipFollowerState.blocksFetchedViaPoll).toBe(0);
	});

	test("recordBlockReceived switches polling back to normal and stops the replay", async () => {
		tipFollowerState.lastBlockReceivedAt = NOW - TIMEOUT_SEC * 1000;
		const fake = fakeDeps({
			chainTip: 105,
			ourHeight: 100,
			onIngest: (height) => {
				if (height === 102) recordBlockReceived();
			},
		});

		await createTipFollowerTick(fake.deps)();

		expect(tipFollowerState.mode).toBe("normal");
		expect(fake.ingested).toEqual([101, 102]);

		tipFollowerState.mode = "polling" as typeof tipFollowerState.mode;
		recordBlockReceived();
		expect(tipFollowerState.mode).toBe("normal");
	});

	test("a node error resets the running guard so the next tick runs", async () => {
		tipFollowerState.lastBlockReceivedAt = NOW - TIMEOUT_SEC * 1000;
		let calls = 0;
		const fake = fakeDeps({
			chainTip: 101,
			ourHeight: 100,
			healthy: async () => {
				calls++;
				if (calls === 1) throw new Error("node down");
				return true;
			},
		});
		const tick = createTipFollowerTick(fake.deps);

		await tick();
		expect(fake.ingested).toEqual([]);

		await tick();
		expect(fake.nodeCalls).toBe(2);
		expect(fake.ingested).toEqual([101]);
	});

	test("an ingest error is logged per height and does not stop the tick", async () => {
		tipFollowerState.lastBlockReceivedAt = NOW - TIMEOUT_SEC * 1000;
		const fake = fakeDeps({
			chainTip: 102,
			ourHeight: 100,
			onIngest: (height) => {
				if (height === 101) throw new Error("ingest failed");
			},
		});
		const tick = createTipFollowerTick(fake.deps);

		await tick();
		expect(fake.ingested).toEqual([102]);
		expect(tipFollowerState.blocksFetchedViaPoll).toBe(1);

		await tick();
		expect(fake.nodeCalls).toBe(2);
	});

	test("a tick already in flight makes an overlapping tick a no-op", async () => {
		tipFollowerState.lastBlockReceivedAt = NOW - TIMEOUT_SEC * 1000;
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const fake = fakeDeps({
			chainTip: 101,
			ourHeight: 100,
			healthy: async () => {
				await gate;
				return true;
			},
		});
		const tick = createTipFollowerTick(fake.deps);

		const first = tick();
		await tick();
		expect(fake.nodeCalls).toBe(1);

		release();
		await first;
		expect(fake.ingested).toEqual([101]);
	});
});
