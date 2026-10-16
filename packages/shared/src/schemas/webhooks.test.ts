import { afterEach, describe, expect, it } from "bun:test";
import {
	CHAIN_TRIGGER_FIELDS,
	CHAIN_TRIGGER_TYPES,
	ChainTriggerSchema,
	CreateWebhookRequestSchema,
	ReplayWebhookRequestSchema,
	UpdateWebhookRequestSchema,
	managedByForName,
	trigger,
	webhookMaxRetriesCeiling,
	webhookTimeoutMsCeiling,
} from "./webhooks.ts";

describe("CHAIN_TRIGGER_FIELDS", () => {
	it("covers every chain trigger type", () => {
		expect(Object.keys(CHAIN_TRIGGER_FIELDS).sort()).toEqual(
			[...CHAIN_TRIGGER_TYPES].sort(),
		);
	});

	it("matches the validator's per-type fields (never drifts, excludes `type`)", () => {
		// biome-ignore lint/suspicious/noExplicitAny: zod-internal introspection mirrors the derivation
		for (const opt of (ChainTriggerSchema as any)._zod.def.options) {
			const shape = opt._zod.def.shape as Record<string, unknown>;
			// biome-ignore lint/suspicious/noExplicitAny: literal value on the zod-internal def
			const type = (shape.type as any)._zod.def.values[0] as string;
			const expected = Object.keys(shape).filter((k) => k !== "type");
			expect(CHAIN_TRIGGER_FIELDS[type]).toEqual(expected);
		}
	});

	it("locks known shapes", () => {
		expect(CHAIN_TRIGGER_FIELDS.stx_transfer).toEqual([
			"sender",
			"recipient",
			"minAmount",
			"maxAmount",
		]);
		expect(CHAIN_TRIGGER_FIELDS.contract_call).toEqual([
			"contractId",
			"functionName",
			"caller",
			"trait",
		]);
	});
});

describe("webhook schemas", () => {
	it("accepts supported formats and trigger limits on create", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "large-transfers",
			triggers: [{ type: "stx_transfer", minAmount: "1000000" }],
			url: "https://example.com/webhook",
			format: "standard-webhooks",
			maxRetries: 5,
			timeoutMs: 10_000,
			concurrency: 2,
		});

		expect(parsed.format).toBe("standard-webhooks");
	});

	it("defaults create format to standard-webhooks", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "default-format",
			triggers: [{ type: "stx_transfer" }],
			url: "http://localhost:3000/webhook",
		});

		expect(parsed.format).toBe("standard-webhooks");
	});

	it("rejects invalid create/update/replay payloads", () => {
		expect(() =>
			CreateWebhookRequestSchema.parse({
				name: "bad",
				triggers: [{ type: "stx_transfer" }],
				url: "ftp://example.com/webhook",
				format: "xml",
			}),
		).toThrow();

		expect(() => UpdateWebhookRequestSchema.parse({})).toThrow();

		expect(() =>
			ReplayWebhookRequestSchema.parse({
				fromBlock: 20,
				toBlock: 10,
			}),
		).toThrow();
	});
});

describe("print_event where", () => {
	const POX5 = "SP000000000000000000002Q6VF78.pox-5";
	const managers = [
		"SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager",
		"SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP.fastpool-1-signer-manager",
	];
	const print = (where: unknown) =>
		ChainTriggerSchema.safeParse({
			type: "print_event",
			contractId: POX5,
			where,
		});

	it("accepts the signer + signer-manager trigger pair", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "fastpool",
			url: "https://example.com/h",
			triggers: [
				{ type: "print_event", contractId: POX5, where: { signer: managers } },
				{
					type: "print_event",
					contractId: POX5,
					where: { "signer-manager": managers },
				},
			],
		});
		expect(r.success).toBe(true);
	});

	it("trigger.printEvent carries where onto the wire trigger", () => {
		expect(
			trigger.printEvent({ contractId: POX5, where: { cycle: "112" } }),
		).toEqual({
			type: "print_event",
			contractId: POX5,
			where: { cycle: "112" },
		});
	});

	it("rejects more than 20 values for one key", () => {
		const values = Array.from({ length: 21 }, (_, i) => `SP${i}`);
		expect(print({ signer: values }).success).toBe(false);
		expect(print({ signer: values.slice(0, 20) }).success).toBe(true);
	});

	it("rejects more than 10 keys", () => {
		const where = Object.fromEntries(
			Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"]),
		);
		expect(print(where).success).toBe(false);
	});

	it("rejects an empty where object", () => {
		expect(print({}).success).toBe(false);
	});

	it("rejects non-string values", () => {
		expect(print({ cycle: 112 }).success).toBe(false);
		expect(print({ ok: true }).success).toBe(false);
		expect(print({ signer: [] }).success).toBe(false);
	});

	it("is not accepted on other trigger types", () => {
		const r = ChainTriggerSchema.safeParse({
			type: "contract_call",
			where: { signer: "SP1" },
		});
		expect(r.success).toBe(false);
	});
});

describe("chain webhooks (direct chain triggers)", () => {
	it("accepts a webhook with triggers", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "swaps",
			url: "https://example.com/webhook",
			triggers: [
				{
					type: "contract_call",
					contractId: "SP123.amm",
					functionName: "swap-*",
				},
				{ type: "ft_transfer", trait: "sip-010", minAmount: "1000000" },
			],
		});
		expect(parsed.triggers).toHaveLength(2);
		expect(parsed.format).toBe("standard-webhooks");
	});

	it("accepts amounts as both string and number", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "x",
			url: "https://x.com/h",
			triggers: [
				{
					type: "stx_transfer",
					minAmount: "340282366920938463463374607431768211455",
				},
				{ type: "stx_burn", minAmount: 100 },
			],
		});
		expect(parsed.triggers).toHaveLength(2);
	});

	it("rejects a create without triggers", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
		});
		expect(r.success).toBe(false);
	});

	it("rejects an unknown field on a trigger (strict)", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call", bogus: 1 }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects an empty triggers array", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [],
		});
		expect(r.success).toBe(false);
	});

	it("rejects an unknown trigger type", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "not_a_real_event" }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects a non-integer amount string", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "stx_transfer", minAmount: "12.5" }],
		});
		expect(r.success).toBe(false);
	});
});

describe("Runes triggers (chain=bitcoin, plan 060)", () => {
	it("accepts every rune trigger variant, rune ref optional", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "runes",
			url: "https://example.com/webhook",
			triggers: [
				{ type: "rune_etch" },
				{ type: "rune_mint", rune: "840000:3" },
				{
					type: "rune_transfer",
					rune: "DOG•GO•TO•THE•MOON",
					address: "bc1qexample",
					minAmount: "1000",
				},
				{ type: "rune_burn", rune: "840000:3" },
			],
		});
		expect(parsed.triggers).toHaveLength(4);
	});

	it("rejects an unknown field on a rune trigger (strict)", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "rune_etch", contractId: "SP123.amm" }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects address/minAmount on rune_etch (rune_transfer-only fields)", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "rune_etch", address: "bc1qexample" }],
		});
		expect(r.success).toBe(false);
	});

	it("a Stacks trigger is unaffected by the rune trigger additions", () => {
		const parsed = CreateWebhookRequestSchema.parse({
			name: "stacks-still-works",
			url: "https://example.com/webhook",
			triggers: [{ type: "ft_transfer", trait: "sip-010" }],
		});
		expect(parsed.triggers).toEqual([
			{ type: "ft_transfer", trait: "sip-010" },
		]);
	});
});

describe("delivery cap ceilings", () => {
	afterEach(() => {
		Reflect.deleteProperty(process.env, "WEBHOOK_MAX_RETRIES_CEILING");
		Reflect.deleteProperty(process.env, "WEBHOOK_TIMEOUT_MS_CEILING");
	});

	it("defaults to the self-host ceilings unchanged (100 retries, 300s)", () => {
		expect(webhookMaxRetriesCeiling()).toBe(100);
		expect(webhookTimeoutMsCeiling()).toBe(300_000);
	});

	it("accepts maxRetries/timeoutMs at the default ceiling", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			maxRetries: 100,
			timeoutMs: 300_000,
		});
		expect(r.success).toBe(true);
	});

	it("rejects maxRetries above the default ceiling with the ceiling in the message", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			maxRetries: 101,
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toBe(
				"maxRetries exceeds ceiling (100)",
			);
		}
	});

	it("rejects timeoutMs above the default ceiling with the ceiling in the message", () => {
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			timeoutMs: 300_001,
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toBe(
				"timeoutMs exceeds ceiling (300000)",
			);
		}
	});

	it("respects a lower WEBHOOK_MAX_RETRIES_CEILING env override", () => {
		process.env.WEBHOOK_MAX_RETRIES_CEILING = "7";
		expect(webhookMaxRetriesCeiling()).toBe(7);
		const r = CreateWebhookRequestSchema.safeParse({
			name: "x",
			url: "https://x.com/h",
			triggers: [{ type: "contract_call" }],
			maxRetries: 8,
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toBe("maxRetries exceeds ceiling (7)");
		}
	});

	it("respects a lower WEBHOOK_TIMEOUT_MS_CEILING env override", () => {
		process.env.WEBHOOK_TIMEOUT_MS_CEILING = "30000";
		expect(webhookTimeoutMsCeiling()).toBe(30_000);
		const r = UpdateWebhookRequestSchema.safeParse({ timeoutMs: 30_001 });
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toBe(
				"timeoutMs exceeds ceiling (30000)",
			);
		}
	});

	it("ignores a non-numeric env override and falls back to the default", () => {
		process.env.WEBHOOK_MAX_RETRIES_CEILING = "not-a-number";
		expect(webhookMaxRetriesCeiling()).toBe(100);
	});
});

describe("managedByForName", () => {
	it("names the owner of a reserved prefix", () => {
		expect(managedByForName("sentinel:SP123.vault:set-admin")).toBe("Sentinel");
	});

	it("leaves ordinary names unmanaged", () => {
		expect(managedByForName("sbtc-deposits")).toBeNull();
	});

	it("matches the prefix case-sensitively", () => {
		expect(managedByForName("Sentinel:x")).toBeNull();
	});
});
