import { describe, expect, test } from "bun:test";
import type { TenantRow } from "./control-db.ts";
import type { SubgraphStoppedEvent } from "./processor-watch.ts";
import type { ProvisionerConfig } from "./provisioner.ts";
import {
	createPushWatch,
	createStoppedReporter,
	postPush,
} from "./push-watch.ts";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString();

const platform = {
	appServerUrl: "https://app.example.com/",
	workloadHostKey: "host-key",
};

function replay(over: Record<string, unknown> = {}) {
	return {
		replayId: "rp_1",
		webhookId: "wh_1",
		status: "done",
		total: 3812,
		delivered: 3790,
		gaveUp: 22,
		finishedAt: ago(5),
		...over,
	};
}

type Call = { url: string; init?: RequestInit };

describe("push watch tick", () => {
	const cfg = {} as ProvisionerConfig;
	const tenant = (id: string, port: number) =>
		({ account_id: id, acct8: id.slice(0, 8), api_port: port }) as TenantRow;

	function harness(handler: (call: Call) => Response) {
		const calls: Call[] = [];
		const tick = createPushWatch(cfg, platform, {
			listTenants: async () => [
				tenant("a".repeat(8), 4001),
				tenant("b".repeat(8), 4002),
			],
			endpointFor: (t) => ({
				baseUrl: `http://127.0.0.1:${t.api_port}`,
				instanceToken: `token-${t.acct8}`,
			}),
			now: () => NOW,
			fetchImpl: async (input, init) => {
				const call = { url: String(input), init };
				calls.push(call);
				return handler(call);
			},
		});
		return { calls, tick };
	}
	const json = (data: unknown) =>
		new Response(JSON.stringify({ data }), { status: 200 });
	const posts = (calls: Call[]) =>
		calls.filter((c) => c.init?.method === "POST");

	test("forwards only done replays finished in the last 30 minutes, named from the webhook list", async () => {
		const { calls, tick } = harness((call) => {
			if (call.url.includes("/api/webhooks/replays"))
				return json([
					replay(),
					replay({ replayId: "rp_old", finishedAt: ago(45) }),
					replay({ replayId: "rp_run", status: "running", finishedAt: null }),
					replay({ replayId: "rp_bad", status: "failed", finishedAt: ago(2) }),
				]);
			if (call.url.includes("/api/webhooks?"))
				return json([{ id: "wh_1", name: "sbtc-deposits" }]);
			return new Response("{}", { status: 200 });
		});
		await tick();

		const sent = posts(calls);
		expect(sent).toHaveLength(2);
		expect(sent[0]?.url).toBe("https://app.example.com/internal/push");
		expect(
			(sent[0]?.init?.headers as Record<string, string>).authorization,
		).toBe("Bearer host-key");
		const body = JSON.parse(String(sent[0]?.init?.body));
		expect(body.accountId).toBe("a".repeat(8));
		expect(body.observedAt).toBe(new Date(NOW).toISOString());
		expect(body.insights).toBeUndefined();
		expect(body.replays).toEqual([
			{
				replayId: "rp_1",
				webhookId: "wh_1",
				webhookName: "sbtc-deposits",
				finishedAt: ago(5),
				delivered: 3790,
				gaveUp: 22,
				total: 3812,
			},
		]);
		expect(calls.some((c) => c.url.includes("/api/insights"))).toBe(false);
	});

	test("posts nothing, and skips the webhook list, when no replay finished", async () => {
		const { calls, tick } = harness(() => json([]));
		await tick();
		expect(posts(calls)).toHaveLength(0);
		expect(calls.some((c) => c.url.includes("/api/webhooks?"))).toBe(false);
	});

	test("a 404 on replays posts nothing and does not throw", async () => {
		const { calls, tick } = harness(
			() => new Response("not found", { status: 404 }),
		);
		await tick();
		expect(posts(calls)).toHaveLength(0);
		expect(calls).toHaveLength(2);
	});

	test("a missing webhook name falls back to the id", async () => {
		const { calls, tick } = harness((call) =>
			call.url.includes("/api/webhooks/replays")
				? json([replay()])
				: call.url.includes("/api/webhooks?")
					? json([])
					: new Response("{}", { status: 200 }),
		);
		await tick();
		const body = JSON.parse(String(posts(calls)[0]?.init?.body));
		expect(body.replays[0].webhookName).toBe("wh_1");
	});

	test("one tenant failing does not stop the next", async () => {
		const { calls, tick } = harness((call) => {
			if (call.url.includes(":4001/"))
				return new Response("boom", { status: 500 });
			if (call.url.includes("/api/webhooks/replays")) return json([replay()]);
			if (call.url.includes("/api/webhooks?")) return json([]);
			return new Response("{}", { status: 200 });
		});
		await tick();
		const sent = posts(calls);
		expect(sent).toHaveLength(1);
		expect(JSON.parse(String(sent[0]?.init?.body)).accountId).toBe(
			"b".repeat(8),
		);
	});

	test("a failing post is swallowed", async () => {
		const { tick } = harness((call) => {
			if (call.url.includes("/api/webhooks/replays")) return json([replay()]);
			if (call.url.includes("/api/webhooks?")) return json([]);
			return new Response("down", { status: 503 });
		});
		await expect(tick()).resolves.toBeUndefined();
	});
});

describe("subgraph stopped reporter", () => {
	test("one stop produces one POST carrying only the stop facts", async () => {
		const calls: Call[] = [];
		const report = createStoppedReporter(platform, {
			now: () => NOW,
			fetchImpl: async (input, init) => {
				calls.push({ url: String(input), init });
				return new Response("{}", { status: 200 });
			},
		});
		const event: SubgraphStoppedEvent = {
			accountId: "acct-1",
			subgraph: "sbtc-flows",
			reason: "stalled",
			height: 1204,
			lastError: null,
			at: NOW - 1000,
		};
		await report(event);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://app.example.com/internal/push");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			accountId: "acct-1",
			observedAt: new Date(NOW).toISOString(),
			stopped: [
				{
					subgraph: "sbtc-flows",
					reason: "stalled",
					height: 1204,
					lastError: null,
				},
			],
		});
	});

	test("postPush never throws when the platform is unreachable", async () => {
		await expect(
			postPush({ ...platform }, { accountId: "a" }, NOW, async () => {
				throw new Error("ECONNREFUSED");
			}),
		).resolves.toBeUndefined();
	});
});
