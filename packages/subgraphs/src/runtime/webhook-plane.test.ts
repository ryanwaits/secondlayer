import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { logger } from "@secondlayer/shared/logger";
import { type WebhookPlaneDeps, startWebhookPlane } from "./webhook-plane.ts";

type OnReorg = Parameters<WebhookPlaneDeps["startStreamsReorgPoll"]>[0];
type ReorgRow = Parameters<OnReorg>[1];

interface Harness {
	deps: WebhookPlaneDeps;
	calls: string[];
	stops: string[];
	polls: Array<{
		onReorg: OnReorg;
		chain: string | undefined;
		needed: (() => Promise<boolean>) | undefined;
	}>;
	gated: Set<OnReorg>;
	reorgs: Array<{ forkHeight: number; chain: string | undefined }>;
}

function harness(opts: { chainWebhooks?: number; testnet?: boolean } = {}) {
	const h: Harness = {
		deps: undefined as unknown as WebhookPlaneDeps,
		calls: [],
		stops: [],
		polls: [],
		gated: new Set(),
		reorgs: [],
	};
	h.deps = {
		listActiveChainWebhooks: async () => {
			h.calls.push("listActiveChainWebhooks");
			return Array.from({ length: opts.chainWebhooks ?? 0 }, () => ({}));
		},
		startStreamsReorgPoll: (onReorg, chain, needed) => {
			h.calls.push(`reorgPoll:${chain ?? "stacks"}`);
			h.polls.push({ onReorg, chain, needed });
			return () => {
				h.stops.push(`reorgPoll:${chain ?? "stacks"}`);
			};
		},
		gateChainReorgOnLeader: (handler) => {
			const gate: OnReorg = async (forkHeight, reorg) => {
				await handler(forkHeight, reorg);
				return undefined as unknown as Awaited<ReturnType<OnReorg>>;
			};
			h.gated.add(gate);
			return gate;
		},
		handleChainReorg: async (forkHeight, _db, chain) => {
			h.reorgs.push({ forkHeight, chain });
		},
		hasActiveRuneWebhooks: async () => true,
		startTriggerEvaluatorLeader: () => {
			h.calls.push("triggerEvaluator");
			return async () => {
				h.stops.push("triggerEvaluator");
			};
		},
		startEmitter: async () => {
			h.calls.push("emitter");
			return async () => {
				h.stops.push("emitter");
			};
		},
		startMeterSocketReporter: () => {
			h.calls.push("meterSocket");
			return () => {
				h.stops.push("meterSocket");
			};
		},
		isTestnetWebhookStack: () => opts.testnet ?? false,
		startInsightsLoop: () => {
			h.calls.push("insights");
			return async () => {
				h.stops.push("insights");
			};
		},
	};
	return h;
}

const reorgRow = { fork_point_height: 10 } as unknown as ReorgRow;

let savedSource: string | undefined;
beforeEach(() => {
	savedSource = process.env.SUBGRAPH_SOURCE;
});
afterEach(() => {
	if (savedSource === undefined) delete process.env.SUBGRAPH_SOURCE;
	else process.env.SUBGRAPH_SOURCE = savedSource;
});

describe("startWebhookPlane", () => {
	test("streams-index starts both leader-gated reorg polls, the evaluator, emitter, meter socket and insights", async () => {
		process.env.SUBGRAPH_SOURCE = "streams-index";
		const h = harness();

		await startWebhookPlane(h.deps);

		expect(h.calls).toEqual([
			"reorgPoll:stacks",
			"reorgPoll:bitcoin",
			"triggerEvaluator",
			"emitter",
			"meterSocket",
			"insights",
		]);
		expect(h.polls).toHaveLength(2);
		for (const poll of h.polls) expect(h.gated.has(poll.onReorg)).toBe(true);
		expect(await h.polls[1]?.needed?.()).toBe(true);

		await h.polls[0]?.onReorg(7, reorgRow);
		await h.polls[1]?.onReorg(8, reorgRow);
		expect(h.reorgs).toEqual([
			{ forkHeight: 7, chain: "stacks" },
			{ forkHeight: 8, chain: "bitcoin" },
		]);
	});

	test("without streams-index, active chain webhooks are checked and reorg polls and evaluator are skipped", async () => {
		delete process.env.SUBGRAPH_SOURCE;
		const h = harness({ chainWebhooks: 2 });
		const warn = spyOn(logger, "warn");

		await startWebhookPlane(h.deps);

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[1]).toEqual({ chainWebhookCount: 2 });
		warn.mockRestore();

		expect(h.calls).toEqual([
			"listActiveChainWebhooks",
			"emitter",
			"meterSocket",
			"insights",
		]);
		expect(h.polls).toHaveLength(0);
	});

	test("the testnet webhook stack skips the insights loop", async () => {
		process.env.SUBGRAPH_SOURCE = "streams-index";
		const h = harness({ testnet: true });

		await startWebhookPlane(h.deps);

		expect(h.calls).not.toContain("insights");
		expect(h.calls).toContain("emitter");
	});

	test("stop() stops every started subsystem", async () => {
		process.env.SUBGRAPH_SOURCE = "streams-index";
		const h = harness();

		const stop = await startWebhookPlane(h.deps);
		await stop();

		expect(h.stops).toEqual([
			"reorgPoll:stacks",
			"reorgPoll:bitcoin",
			"triggerEvaluator",
			"emitter",
			"meterSocket",
			"insights",
		]);
	});
});
