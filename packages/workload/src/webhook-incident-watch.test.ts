import { describe, expect, test } from "bun:test";
import type { TenantRow } from "./control-db.ts";
import type { ProvisionerConfig } from "./provisioner.ts";
import {
	DOWN_MIN_MS,
	type WebhookSummaryLike,
	createWebhookIncidentWatch,
	downWebhooks,
} from "./webhook-incident-watch.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW - minutes * MINUTE).toISOString();

function hook(over: Partial<WebhookSummaryLike> = {}): WebhookSummaryLike {
	return {
		id: "wh_1",
		name: "orders",
		status: "active",
		url: "https://hooks.example.com/in",
		lastSuccessAt: ago(16),
		circuitOpenedAt: null,
		circuitFailures: 5,
		managedBy: null,
		createdAt: ago(60 * 24),
		...over,
	};
}

describe("downWebhooks", () => {
	test("5 failures in a row and the last success 16 minutes ago is down", () => {
		const [one] = downWebhooks([hook()], NOW);
		expect(one).toMatchObject({
			id: "wh_1",
			host: "hooks.example.com",
			failingSince: ago(16),
			failures: 5,
			lastError: null,
		});
	});

	test("4 failures is not down", () => {
		expect(downWebhooks([hook({ circuitFailures: 4 })], NOW)).toEqual([]);
	});

	test("many failures but a success 10 minutes ago is not down", () => {
		expect(
			downWebhooks(
				[hook({ circuitFailures: 20, lastSuccessAt: ago(10) })],
				NOW,
			),
		).toEqual([]);
	});

	test("a manual pause is never down", () => {
		expect(
			downWebhooks([hook({ status: "paused", circuitOpenedAt: null })], NOW),
		).toEqual([]);
	});

	test("a circuit pause is down", () => {
		expect(
			downWebhooks([hook({ status: "paused", circuitOpenedAt: ago(5) })], NOW),
		).toHaveLength(1);
	});

	test("never succeeded and created 20 minutes ago is down from creation", () => {
		const [one] = downWebhooks(
			[hook({ lastSuccessAt: null, createdAt: ago(20) })],
			NOW,
		);
		expect(one?.failingSince).toBe(ago(20));
	});

	test("never succeeded and created 10 minutes ago is not down yet", () => {
		expect(
			downWebhooks([hook({ lastSuccessAt: null, createdAt: ago(10) })], NOW),
		).toEqual([]);
	});

	test("webhooks managed by another product are skipped", () => {
		expect(downWebhooks([hook({ managedBy: "sentinel" })], NOW)).toEqual([]);
	});

	test("the threshold is exactly 15 minutes", () => {
		expect(
			downWebhooks(
				[hook({ lastSuccessAt: new Date(NOW - DOWN_MIN_MS).toISOString() })],
				NOW,
			),
		).toHaveLength(1);
	});

	test("an unparseable url falls back to the raw value without a scheme", () => {
		const [one] = downWebhooks([hook({ url: "not a url" })], NOW);
		expect(one?.host).toBe("not a url");
	});
});

describe("webhook incident watch tick", () => {
	const cfg = {} as ProvisionerConfig;
	const platform = {
		appServerUrl: "https://app.example.com/",
		workloadHostKey: "host-key",
	};

	function tenant(id: string, port: number): TenantRow {
		return {
			account_id: id,
			acct8: id.slice(0, 8),
			api_port: port,
		} as TenantRow;
	}

	type Call = { url: string; init?: RequestInit };

	function harness(handler: (call: Call) => Response) {
		const calls: Call[] = [];
		const tenants = [tenant("a".repeat(8), 4001), tenant("b".repeat(8), 4002)];
		const tick = createWebhookIncidentWatch(cfg, platform, {
			listTenants: async () => tenants,
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

	const list = (data: WebhookSummaryLike[]) =>
		new Response(JSON.stringify({ data }), { status: 200 });

	test("posts every id seen and only the down ones, with the host key", async () => {
		const { calls, tick } = harness((call) =>
			call.url.includes("/api/webhooks")
				? list([hook(), hook({ id: "wh_2", circuitFailures: 0 })])
				: new Response("{}", { status: 200 }),
		);
		await tick();

		const posts = calls.filter((c) => c.init?.method === "POST");
		expect(posts).toHaveLength(2);
		expect(posts[0]?.url).toBe(
			"https://app.example.com/internal/webhook-incidents",
		);
		expect(
			(posts[0]?.init?.headers as Record<string, string>).authorization,
		).toBe("Bearer host-key");
		const body = JSON.parse(String(posts[0]?.init?.body));
		expect(body.accountId).toBe("a".repeat(8));
		expect(body.webhookIds).toEqual(["wh_1", "wh_2"]);
		expect(body.down.map((d: { id: string }) => d.id)).toEqual(["wh_1"]);
		expect(body.observedAt).toBe(new Date(NOW).toISOString());

		const reads = calls.filter((c) => c.url.includes("/api/webhooks"));
		expect(reads[0]?.url).toContain("127.0.0.1:4001/api/webhooks?_limit=200");
		expect(
			(reads[0]?.init?.headers as Record<string, string>).authorization,
		).toBe("Bearer token-aaaaaaaa");
	});

	test("a tenant that errors does not stop the next tenant", async () => {
		const { calls, tick } = harness((call) => {
			if (call.url.includes(":4001/"))
				return new Response("boom", { status: 500 });
			if (call.url.includes("/api/webhooks")) return list([hook()]);
			return new Response("{}", { status: 200 });
		});
		await tick();
		const posts = calls.filter((c) => c.init?.method === "POST");
		expect(posts).toHaveLength(1);
		expect(JSON.parse(String(posts[0]?.init?.body)).accountId).toBe(
			"b".repeat(8),
		);
	});

	test("an app-server error is swallowed and the next tenant still posts", async () => {
		const { calls, tick } = harness((call) =>
			call.url.includes("/api/webhooks")
				? list([hook()])
				: new Response("down", { status: 500 }),
		);
		await expect(tick()).resolves.toBeUndefined();
		expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(2);
	});
});
