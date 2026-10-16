import { describe, expect, test } from "bun:test";
import { InsightSchema } from "../schemas/insights.ts";
import type { DetectedInsight } from "./types.ts";
import {
	type DeliveryAttempt,
	WEBHOOK_RULES,
	type WebhookRuleInput,
	canonicalJson,
	isTestHost,
} from "./webhook-rules.ts";

const NOW = new Date("2026-10-15T18:00:00.000Z");
const MIN = 60_000;
const DAY = 86_400_000;

/** Every insight a fixture fires lands here for the prompt guard at the end. */
const collected: DetectedInsight[] = [];

function attempt(
	over: Partial<DeliveryAttempt> & { agoMin: number },
): DeliveryAttempt {
	const { agoMin, ...rest } = over;
	return {
		outboxId: null,
		statusCode: 200,
		durationMs: 100,
		dispatchedAt: new Date(NOW.getTime() - agoMin * MIN),
		errorMessage: null,
		body: null,
		contentType: "application/json",
		server: null,
		retryAfter: null,
		blockHeight: null,
		...rest,
	};
}

/** `n` attempts, newest first, one minute apart starting `startAgo` minutes ago. */
function run(
	n: number,
	over: Partial<DeliveryAttempt>,
	startAgo = 1,
): DeliveryAttempt[] {
	return Array.from({ length: n }, (_, i) =>
		attempt({ ...over, agoMin: startAgo + i }),
	);
}

function input(over: Partial<WebhookRuleInput> = {}): WebhookRuleInput {
	return {
		now: NOW,
		webhook: {
			id: "wh-1",
			name: "sbtc-deposits",
			status: "active",
			url: "https://hooks.example.dev/in",
			triggers: [],
			timeoutMs: 5000,
			createdAt: new Date(NOW.getTime() - 30 * DAY),
			lastSuccessAt: new Date(NOW.getTime() - 3 * 3600_000),
			receiverCertExpiresAt: null,
			receiverCertCheckedAt: null,
		},
		attempts: [],
		pending: 0,
		throughput: {
			startMs: NOW.getTime() - 36 * 10 * MIN,
			matched: new Array(36).fill(8),
			delivered: new Array(36).fill(8),
		},
		dailyP95: Array.from({ length: 14 }, (_, i) => ({
			day: new Date(NOW.getTime() - (13 - i) * DAY).toISOString().slice(0, 10),
			p95Ms: 300,
		})),
		dead: { count: 0, oldestAt: null, oldestOutboxId: null },
		deliveries30d: 100,
		siblings: [],
		abi: {},
		abiAvailable: true,
		...over,
	};
}

function rule(id: string) {
	const found = WEBHOOK_RULES.find((r) => r.id === id);
	if (!found) throw new Error(`no rule ${id}`);
	return found;
}

function fire(id: string, i: WebhookRuleInput): DetectedInsight | null {
	const result = rule(id).evaluate(i);
	if (result) {
		collected.push(result);
		expect(
			InsightSchema.safeParse({
				...result,
				id: "i",
				createdAt: NOW.toISOString(),
			}).success,
		).toBe(true);
	}
	return result;
}

describe("receiver_down", () => {
	test("fires on exactly 5 failures in a row", () => {
		const out = fire(
			"receiver_down",
			input({
				attempts: [
					...run(5, { statusCode: 502, server: "nginx", body: "Bad Gateway" }),
					...run(10, {}, 6),
				],
				pending: 214,
			}),
		);
		expect(out?.severity).toBe("losing");
		expect(out?.impact).toBe(214);
		expect(out?.resource).toEqual({
			kind: "webhook",
			id: "wh-1",
			name: "sbtc-deposits",
		});
		expect(out?.handoff.prompt).toContain("nginx");
		expect(out?.handoff.commands).toEqual([
			"sl webhooks doctor sbtc-deposits",
			"sl webhooks dead sbtc-deposits",
		]);
		expect(out?.evidence.map((e) => e.kind)).toEqual(["series", "shapes"]);
	});

	test("does not fire on 4 failures", () => {
		expect(
			fire(
				"receiver_down",
				input({
					attempts: [...run(4, { statusCode: 502 }), ...run(10, {}, 5)],
				}),
			),
		).toBeNull();
	});

	test("counts no-response attempts and stops at the first success", () => {
		const out = fire(
			"receiver_down",
			input({
				attempts: [
					...run(3, { statusCode: null }),
					...run(2, { statusCode: 503 }, 4),
					...run(1, { statusCode: 200 }, 6),
					...run(9, { statusCode: 500 }, 7),
				],
			}),
		);
		expect(out?.how.facts[0]).toEqual(["consecutive failures", "5"]);
	});

	test("marks a shape new only when the prior week never saw it", () => {
		const out = fire(
			"receiver_down",
			input({
				attempts: [
					...run(5, { statusCode: 502, body: "Bad Gateway" }),
					...run(3, { statusCode: 503, body: "Unavailable" }, 6),
				],
			}),
		);
		const shapes = out?.evidence.find((e) => e.kind === "shapes");
		expect(shapes?.kind === "shapes" && shapes.shapes[0]?.isNew).toBe(true);
		const seen = fire(
			"receiver_down",
			input({
				attempts: [
					...run(5, { statusCode: 502, body: "Bad Gateway" }),
					...run(1, { statusCode: 200 }, 6),
					...run(3, { statusCode: 502, body: "Bad Gateway" }, 7),
				],
			}),
		);
		const seenShapes = seen?.evidence.find((e) => e.kind === "shapes");
		expect(seenShapes?.kind === "shapes" && seenShapes.shapes[0]?.isNew).toBe(
			false,
		);
	});
});

describe("receiver_rejects", () => {
	test("fires on exactly 5 rejects in a row", () => {
		const out = fire(
			"receiver_rejects",
			input({
				attempts: [
					...run(5, { statusCode: 401, body: "bad signature" }),
					...run(5, {}, 6),
				],
			}),
		);
		expect(out?.severity).toBe("losing");
		expect(out?.body).toContain("bad signature");
		expect(out?.handoff.commands).toEqual(["sl webhooks test sbtc-deposits"]);
	});

	test("does not fire on 4 rejects", () => {
		expect(
			fire(
				"receiver_rejects",
				input({ attempts: run(4, { statusCode: 401 }) }),
			),
		).toBeNull();
	});

	test("treats 429 and 5xx as something else", () => {
		expect(
			fire(
				"receiver_rejects",
				input({ attempts: run(8, { statusCode: 429 }) }),
			),
		).toBeNull();
		expect(
			fire(
				"receiver_rejects",
				input({ attempts: run(8, { statusCode: 500 }) }),
			),
		).toBeNull();
	});
});

describe("receiver_rate_limited", () => {
	test("fires at exactly 10 attempts and 50% 429", () => {
		const out = fire(
			"receiver_rate_limited",
			input({
				attempts: [
					...run(5, { statusCode: 429, retryAfter: "60" }),
					...run(5, { statusCode: 200 }, 6),
				],
			}),
		);
		expect(out?.severity).toBe("will_fail");
		expect(out?.how.facts).toContainEqual(["latest Retry-After", "60s"]);
		expect(out?.handoff.commands).toEqual([
			"sl webhooks deliveries sbtc-deposits",
		]);
	});

	test("does not fire below 50%", () => {
		expect(
			fire(
				"receiver_rate_limited",
				input({ attempts: [...run(4, { statusCode: 429 }), ...run(6, {}, 5)] }),
			),
		).toBeNull();
	});

	test("does not fire with fewer than 10 attempts", () => {
		expect(
			fire(
				"receiver_rate_limited",
				input({ attempts: run(9, { statusCode: 429 }) }),
			),
		).toBeNull();
	});
});

describe("receiver_login_wall", () => {
	const html = {
		statusCode: 200,
		contentType: "text/html; charset=utf-8",
		body: "<!doctype html><title>Sign in</title>",
	};

	test("fires on 20 html responses after a JSON week, with a replay command", () => {
		const out = fire(
			"receiver_login_wall",
			input({
				attempts: [
					...run(20, { ...html }).map((a, i) => ({
						...a,
						blockHeight: 900 + i,
					})),
					...run(30, { contentType: "application/json" }, 21),
				],
			}),
		);
		expect(out?.severity).toBe("losing");
		expect(out?.handoff.commands).toEqual([
			"sl webhooks replay sbtc-deposits --from-block 900 --to-block 919 -y",
		]);
	});

	test("omits the replay command when block heights are unknown", () => {
		const out = fire(
			"receiver_login_wall",
			input({ attempts: [...run(20, html), ...run(30, {}, 21)] }),
		);
		expect(out?.handoff.commands).toEqual([]);
	});

	test("does not fire on 19 html responses", () => {
		expect(
			fire(
				"receiver_login_wall",
				input({ attempts: [...run(19, html), ...run(30, {}, 20)] }),
			),
		).toBeNull();
	});

	test("does not fire when the week before was not mostly JSON", () => {
		const prior = [
			...run(7, { contentType: "application/json" }, 21),
			...run(3, { contentType: "text/html" }, 28),
		];
		// 7 of 10 is 70 percent, under the 80 percent line.
		expect(
			fire(
				"receiver_login_wall",
				input({ attempts: [...run(20, html), ...prior] }),
			),
		).toBeNull();
		// Exactly 8 of 10 clears it.
		const edge = [
			...run(8, { contentType: "application/json" }, 21),
			...run(2, { contentType: "text/html" }, 29),
		];
		expect(
			fire(
				"receiver_login_wall",
				input({ attempts: [...run(20, html), ...edge] }),
			),
		).not.toBeNull();
	});

	test("does not fire without a baseline", () => {
		expect(
			fire(
				"receiver_login_wall",
				input({ attempts: [...run(20, html), ...run(9, {}, 21)] }),
			),
		).toBeNull();
	});
});

describe("receiver_slowing", () => {
	function days(values: (number | null)[]) {
		return values.map((p95Ms, i) => ({
			day: new Date(NOW.getTime() - (values.length - 1 - i) * DAY)
				.toISOString()
				.slice(0, 10),
			p95Ms,
		}));
	}
	const climbing = Array.from({ length: 14 }, (_, i) => 1000 + i * 200);

	test("fires on a steady climb that reaches the timeout", () => {
		const out = fire("receiver_slowing", input({ dailyP95: days(climbing) }));
		expect(out?.severity).toBe("will_fail");
		expect(out?.evidence[0]?.kind).toBe("series");
		expect(out?.handoff.commands).toEqual([
			"sl webhooks deliveries sbtc-deposits",
		]);
	});

	test("does not fire on a flat week", () => {
		expect(
			fire(
				"receiver_slowing",
				input({ dailyP95: days(new Array(14).fill(400)) }),
			),
		).toBeNull();
	});

	test("needs rises on 10 of the days: 10 fires, 9 does not", () => {
		// 10 rises then 3 flat days.
		const ten = [
			...Array.from({ length: 11 }, (_, i) => 1000 + i * 300),
			4000,
			4000,
			4000,
		];
		expect(
			fire("receiver_slowing", input({ dailyP95: days(ten) })),
		).not.toBeNull();
		// 9 rises then 4 flat days.
		const nine = [
			...Array.from({ length: 10 }, (_, i) => 1000 + i * 300),
			3700,
			3700,
			3700,
			3700,
		];
		expect(
			fire("receiver_slowing", input({ dailyP95: days(nine) })),
		).toBeNull();
	});

	test("does not fire when the trend stays under the timeout for two weeks", () => {
		const gentle = Array.from({ length: 14 }, (_, i) => 200 + i * 10);
		expect(
			fire("receiver_slowing", input({ dailyP95: days(gentle) })),
		).toBeNull();
	});

	test("does not fire when the fit is poor", () => {
		const noisy = [
			900, 3000, 1000, 2900, 1200, 2800, 1500, 2700, 1800, 2600, 2100, 2500,
			2400, 2400,
		];
		expect(
			fire("receiver_slowing", input({ dailyP95: days(noisy) })),
		).toBeNull();
	});
});

describe("tls_expiring", () => {
	const withCert = (ms: number | null) =>
		input({
			webhook: {
				...input().webhook,
				receiverCertExpiresAt:
					ms === null ? null : new Date(NOW.getTime() + ms),
				receiverCertCheckedAt: new Date(NOW.getTime() - 3600_000),
			},
		});

	test("fires 13 days out", () => {
		const out = fire("tls_expiring", withCert(13 * DAY));
		expect(out?.severity).toBe("will_fail");
		expect(out?.handoff.commands).toEqual([]);
	});

	test("does not fire at exactly 14 days or beyond", () => {
		expect(fire("tls_expiring", withCert(14 * DAY))).toBeNull();
		expect(fire("tls_expiring", withCert(40 * DAY))).toBeNull();
	});

	test("does not fire without a probed certificate", () => {
		expect(fire("tls_expiring", withCert(null))).toBeNull();
	});

	test("fires after the certificate has expired", () => {
		const out = fire("tls_expiring", withCert(-2 * DAY));
		expect(out?.lead).toContain("expired");
	});
});

describe("filter_cant_match", () => {
	const trigger = (over: Record<string, unknown>) => ({
		type: "contract_call",
		contractId: "SP1.pool",
		functionName: "set-implemention",
		...over,
	});
	const withTriggers = (
		triggers: unknown[],
		abi: Record<string, string[]>,
		abiAvailable = true,
	) => input({ webhook: { ...input().webhook, triggers }, abi, abiAvailable });

	test("fires when the contract has no such function, naming the closest", () => {
		const out = fire(
			"filter_cant_match",
			withTriggers([trigger({})], {
				"SP1.pool": ["set-implementation", "deposit", "withdraw"],
			}),
		);
		expect(out?.severity).toBe("will_fail");
		expect(out?.body).toContain("The closest is set-implementation");
		expect(out?.evidence[0]).toMatchObject({ kind: "table", markRow: 0 });
		expect(out?.handoff.commands).toEqual(["sl webhooks delete sbtc-deposits"]);
	});

	test("does not fire when the function exists", () => {
		expect(
			fire(
				"filter_cant_match",
				withTriggers([trigger({ functionName: "deposit" })], {
					"SP1.pool": ["deposit"],
				}),
			),
		).toBeNull();
	});

	test("skips wildcard triggers and contracts that are not in the registry", () => {
		expect(
			fire(
				"filter_cant_match",
				withTriggers([trigger({ functionName: "set-*" })], {
					"SP1.pool": ["x"],
				}),
			),
		).toBeNull();
		expect(
			fire("filter_cant_match", withTriggers([trigger({})], {})),
		).toBeNull();
	});

	test("skips the whole rule when the ABI could not be read", () => {
		const r = rule("filter_cant_match");
		expect(r.skip?.(withTriggers([trigger({})], {}, false))).toBe(true);
		// No literal contract triggers: nothing to look up, so not skipped.
		expect(r.skip?.(withTriggers([], {}, false))).toBe(false);
	});

	test("caps the function list at 6 plus the trigger row", () => {
		const names = Array.from({ length: 12 }, (_, i) => `fn-${i}`);
		const out = fire(
			"filter_cant_match",
			withTriggers([trigger({})], { "SP1.pool": names }),
		);
		const table = out?.evidence[0];
		expect(table?.kind === "table" && table.rows.length).toBe(7);
	});
});

describe("dead_letters_expiring", () => {
	test("fires with the oldest row's requeue command", () => {
		const out = fire(
			"dead_letters_expiring",
			input({
				dead: {
					count: 12,
					oldestAt: new Date(NOW.getTime() - 84 * DAY),
					oldestOutboxId: "ob-1",
				},
			}),
		);
		expect(out?.severity).toBe("will_fail");
		expect(out?.impact).toBe(12);
		expect(out?.handoff.commands).toEqual([
			"sl webhooks dead sbtc-deposits",
			"sl webhooks requeue sbtc-deposits ob-1",
		]);
	});

	test("does not fire with no old dead rows", () => {
		expect(fire("dead_letters_expiring", input())).toBeNull();
	});

	test("reports the deletion date 90 days after the oldest failure", () => {
		const oldest = new Date(NOW.getTime() - 83 * DAY);
		const out = fire(
			"dead_letters_expiring",
			input({ dead: { count: 1, oldestAt: oldest, oldestOutboxId: null } }),
		);
		expect(out?.how.facts).toContainEqual([
			"oldest is deleted",
			"Oct 22 18:00 UTC",
		]);
		expect(out?.handoff.commands).toEqual(["sl webhooks dead sbtc-deposits"]);
	});
});

describe("duplicate_webhook", () => {
	const twin = (over: Record<string, unknown> = {}) => ({
		id: "wh-0",
		name: "older-twin",
		url: "https://hooks.example.dev/in",
		triggers: [{ type: "stx_transfer", sender: "SP1" }],
		createdAt: new Date(NOW.getTime() - 60 * DAY),
		...over,
	});
	const mine = (triggers: unknown) => ({ ...input().webhook, triggers });

	test("fires on the newer webhook, ignoring key order", () => {
		const out = fire(
			"duplicate_webhook",
			input({
				webhook: mine([{ sender: "SP1", type: "stx_transfer" }]),
				siblings: [twin()],
			}),
		);
		expect(out?.severity).toBe("costs");
		expect(out?.handoff.commands).toEqual(["sl webhooks delete sbtc-deposits"]);
	});

	test("does not fire on the older webhook", () => {
		const out = fire(
			"duplicate_webhook",
			input({
				webhook: {
					...mine([{ type: "stx_transfer", sender: "SP1" }]),
					createdAt: new Date(NOW.getTime() - 90 * DAY),
				},
				siblings: [twin()],
			}),
		);
		expect(out).toBeNull();
	});

	test("does not fire when the URL or triggers differ", () => {
		const triggers = [{ type: "stx_transfer", sender: "SP1" }];
		expect(
			fire(
				"duplicate_webhook",
				input({
					webhook: mine(triggers),
					siblings: [twin({ url: "https://other.dev" })],
				}),
			),
		).toBeNull();
		expect(
			fire(
				"duplicate_webhook",
				input({
					webhook: mine(triggers),
					siblings: [
						twin({ triggers: [{ type: "stx_transfer", sender: "SP2" }] }),
					],
				}),
			),
		).toBeNull();
	});

	test("canonicalJson sorts keys at every depth", () => {
		expect(canonicalJson({ b: { d: 1, c: 2 }, a: [1, { z: 1, y: 2 }] })).toBe(
			canonicalJson({ a: [1, { y: 2, z: 1 }], b: { c: 2, d: 1 } }),
		);
	});
});

describe("test_endpoint", () => {
	const at = (url: string, ageDays: number) =>
		input({
			webhook: {
				...input().webhook,
				url,
				createdAt: new Date(NOW.getTime() - ageDays * DAY),
			},
		});

	test("fires for a test host older than 7 days", () => {
		const out = fire("test_endpoint", at("https://webhook.site/abc", 8));
		expect(out?.severity).toBe("costs");
		expect(out?.handoff.commands).toEqual([
			"sl webhooks pause sbtc-deposits",
			"sl webhooks delete sbtc-deposits",
		]);
	});

	test("does not fire at exactly 7 days or for a real host", () => {
		expect(fire("test_endpoint", at("https://webhook.site/abc", 7))).toBeNull();
		expect(
			fire("test_endpoint", at("https://hooks.example.dev/in", 90)),
		).toBeNull();
	});

	test("matches the whole host list", () => {
		for (const host of [
			"postman-echo.com",
			"webhook.site",
			"abc.ngrok.io",
			"abc.ngrok-free.app",
			"requestbin.net",
			"eo1.pipedream.net",
		]) {
			expect(isTestHost(host)).toBe(true);
		}
		for (const host of [
			"ngrok.io.example.com",
			"notwebhook.site",
			"example.com",
		]) {
			expect(isTestHost(host)).toBe(false);
		}
	});
});

describe("hand-off prompts and copy", () => {
	test("rules fired in this file, at least one per rule", () => {
		const ids = new Set(collected.map((c) => c.rule));
		for (const r of WEBHOOK_RULES) expect(ids.has(r.id)).toBe(true);
	});

	test("no prompt contains code", () => {
		for (const insight of collected) {
			const prompt = insight.handoff.prompt;
			expect(prompt).not.toContain("```");
			expect(prompt).not.toContain("{");
			expect(prompt).not.toContain("=>");
			expect(prompt).not.toContain("function");
			expect(prompt).not.toContain("import");
			expect(prompt.length).toBeGreaterThan(40);
		}
	});

	test("no copy uses an em dash or a backtick", () => {
		for (const insight of collected) {
			for (const text of [
				insight.line,
				insight.meta ?? "",
				insight.lead,
				insight.body,
				insight.handoff.prompt,
			]) {
				expect(text).not.toContain("—");
				expect(text).not.toContain("`");
			}
		}
	});

	test("every hand-off command starts with sl", () => {
		for (const insight of collected) {
			for (const cmd of insight.handoff.commands)
				expect(cmd.startsWith("sl ")).toBe(true);
		}
	});
});
