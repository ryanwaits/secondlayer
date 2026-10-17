import { describe, expect, test } from "bun:test";
import type { ChainTrigger, WebhookDetail } from "@secondlayer/sdk";
import {
	CHAIN_TRIGGER_FIELDS,
	CHAIN_TRIGGER_TYPES,
} from "@secondlayer/sdk/webhooks/triggers";
import {
	type Piece,
	agentPrompt,
	describeTrigger,
	webhookSource,
} from "./describe-trigger";

const ADDR = "SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP";
const POX5 = "SP000000000000000000002Q6VF78.pox-5";
const VAULT = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-vault-sbtc";
const AMM = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-vault-v2-01";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
const FP1 = `${ADDR}.fastpool-1-signer-manager`;
const FP2 =
	"SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager";
const GUILD =
	"SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.the-explorer-guild::The-Explorer-Guild";

const text = (pieces: Piece[]) => pieces.map((p) => p.text).join("");
const t = (value: Record<string, unknown>) => value as unknown as ChainTrigger;

const GOLDEN: [Record<string, unknown>, string][] = [
	[
		{ type: "stx_transfer", sender: ADDR, minAmount: "1000000000" },
		"STX transfers sent by SP21YT…EFFP of 1,000 STX or more",
	],
	[
		{ type: "stx_mint", recipient: ADDR, minAmount: "5000000" },
		"STX mints to SP21YT…EFFP of 5 STX or more",
	],
	[{ type: "stx_burn", sender: ADDR }, "STX burns from SP21YT…EFFP"],
	[
		{ type: "stx_lock", lockedAddress: ADDR, minAmount: "100000000000" },
		"STX locks by SP21YT…EFFP of 100,000 STX or more",
	],
	[
		{ type: "ft_transfer", assetIdentifier: SBTC, minAmount: "100000000" },
		"Token transfers of 1 sBTC or more",
	],
	[
		{
			type: "ft_mint",
			assetIdentifier:
				"SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex::alex",
			recipient: ADDR,
		},
		"Token mints of alex to SP21YT…EFFP",
	],
	[
		{ type: "ft_burn", trait: "sip-010" },
		"Token burns on any contract implementing sip-010",
	],
	[
		{ type: "nft_transfer", assetIdentifier: GUILD, recipient: ADDR },
		"NFT transfers of The-Explorer-Guild to SP21YT…EFFP",
	],
	[
		{ type: "nft_mint", assetIdentifier: GUILD },
		"NFT mints of The-Explorer-Guild",
	],
	[{ type: "nft_burn", sender: ADDR }, "NFT burns from SP21YT…EFFP"],
	[
		{ type: "contract_call", contractId: AMM, functionName: "swap-*" },
		"Contract calls to amm-vault-v2-01 calling any function starting with swap-",
	],
	[
		{ type: "contract_deploy", deployer: ADDR, contractName: "amm-*" },
		"Contract deploys by SP21YT…EFFP with a name starting with amm-",
	],
	[
		{ type: "print_event", contractId: POX5, where: { signer: [FP1, FP2] } },
		"Print events from pox-5 where signer is one of these 2 contracts",
	],
	[
		{ type: "nested_contract_call", contractId: POX5, caller: VAULT },
		"Nested contract calls to pox-5 made by v0-vault-sbtc",
	],
	[
		{ type: "var_set", contractId: VAULT, varName: "paused" },
		"Data-var writes on v0-vault-sbtc to paused",
	],
	[
		{ type: "map_set", contractId: AMM, map: "reserve" },
		"Map writes on amm-vault-v2-01 to map reserve",
	],
	[
		{ type: "map_insert", contractId: AMM, map: "reserve" },
		"Map inserts on amm-vault-v2-01 to map reserve",
	],
	[
		{ type: "map_delete", contractId: AMM, map: "reserve" },
		"Map deletes on amm-vault-v2-01 to map reserve",
	],
	[
		{ type: "sbtc_deposit", minAmount: "10000000", maxAmount: "500000000" },
		"sBTC deposits between 0.1 and 5 sBTC",
	],
	[
		{ type: "sbtc_withdrawal_create", sender: ADDR, maxAmount: "50000000" },
		"sBTC withdrawal requests from SP21YT…EFFP of 0.5 sBTC or less",
	],
	[
		{ type: "sbtc_withdrawal_accept", requestId: "412" },
		"sBTC withdrawal accepts for request #412",
	],
	[{ type: "sbtc_withdrawal_reject" }, "Every sBTC withdrawal reject on chain"],
	[
		{
			type: "sbtc_withdrawal_swept_confirmed",
			sweepTxid:
				"3a9f0c7d2e1b44a8c9f0e6d5b4a3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f71b2d",
		},
		"sBTC withdrawal sweeps in Bitcoin tx 3a9f0c…1b2d",
	],
	[{ type: "rune_etch" }, "Every rune etch on chain"],
	[
		{ type: "rune_mint", rune: "UNCOMMON•GOODS" },
		"Rune mints of UNCOMMON•GOODS",
	],
	[
		{
			type: "rune_transfer",
			rune: "DOG•GO•TO•THE•MOON",
			address: "bc1p8qyl7v3xk2m0jw5r9t4e6ua2dz7h3kz2",
			minAmount: "1000000",
		},
		"Rune transfers of DOG•GO•TO•THE•MOON, 1,000,000 base units or more to bc1p8q…3kz2",
	],
	[
		{ type: "rune_burn", rune: "DOG•GO•TO•THE•MOON" },
		"Rune burns of DOG•GO•TO•THE•MOON",
	],
];

const fastpool = [
	t({ type: "print_event", contractId: POX5, where: { signer: [FP1, FP2] } }),
	t({
		type: "print_event",
		contractId: POX5,
		where: { "signer-manager": [FP1, FP2] },
	}),
];

/** Row refs a field's code can carry: its own, a range, or a merged asset/rune. */
function coveringRefs(trigger: Record<string, unknown>, field: string) {
	if (field.startsWith("where.")) return [field];
	if (field === "minAmount" || field === "maxAmount")
		return [
			field,
			"amount",
			...["assetIdentifier", "rune"].filter((k) => trigger[k] !== undefined),
		];
	return [field];
}

describe("golden lines", () => {
	test("the fixtures cover every chain-trigger type exactly", () => {
		expect(GOLDEN.map(([f]) => f.type).sort()).toEqual(
			[...CHAIN_TRIGGER_TYPES].sort(),
		);
	});

	for (const [fixture, expected] of GOLDEN) {
		test(`${fixture.type} reads as "${expected}"`, () => {
			const trigger = t(fixture);
			expect(text(describeTrigger(trigger, 0, [trigger]).line)).toBe(expected);
		});
	}
});

describe("invariants over every fixture", () => {
	for (const [fixture] of GOLDEN) {
		test(`${fixture.type}: every set field has one focus link, every link has rows, no em dash`, () => {
			const trigger = t(fixture);
			const d = describeTrigger(trigger, 0, [trigger], 1200);
			const focus = d.prose.flatMap((s) => (s.focus ? [s.focus] : []));
			const fields = Object.keys(fixture)
				.filter((k) => k !== "type")
				.flatMap((k) =>
					k === "where"
						? Object.keys(fixture.where as object).map((w) => `where.${w}`)
						: [k],
				);
			if (!fields.length) expect(focus).toEqual([]);
			for (const field of fields) {
				const matches = focus.filter((r) =>
					coveringRefs(fixture, field).includes(r),
				);
				expect(matches.length === 1 || focus.includes("more")).toBe(true);
			}
			for (const ref of focus)
				expect(d.source).toMatch(
					new RegExp(`// !ref\\(1:\\d+\\) ${ref}$`, "m"),
				);
			const all = `${text(d.line)}${d.prose.map((s) => text(s.pieces)).join("")}${d.tail}`;
			expect(all).not.toContain("—");
		});
	}
});

describe("fields without a phrase", () => {
	const sample: Record<string, unknown> = {
		where: { signer: "x" },
		minAmount: "5",
		maxAmount: "9",
		requestId: "7",
		contractId: POX5,
		assetIdentifier: SBTC,
	};
	for (const [type, fields] of Object.entries(CHAIN_TRIGGER_FIELDS)) {
		for (const field of fields as readonly string[]) {
			test(`${type}.${field} never renders as a fallback`, () => {
				const trigger = t({
					type,
					[field]: sample[field] ?? `sample-${field}`,
				});
				const d = describeTrigger(trigger, 0, [trigger]);
				// A fallback prints the field name itself as code.
				expect(d.line.some((p) => p.code && p.text === field)).toBe(false);
			});
		}
	}

	test("an unknown field falls back to with {field} {value}", () => {
		const trigger = t({ type: "stx_burn", mystery: "42" });
		const d = describeTrigger(trigger, 0, [trigger]);
		expect(text(d.line)).toBe("STX burns with mystery 42");
		expect(d.prose.some((s) => s.focus === "mystery")).toBe(true);
	});
});

describe("siblings", () => {
	test("same where values under another key point at the other key", () => {
		const d = describeTrigger(fastpool[0] as ChainTrigger, 0, fastpool);
		expect(d.tail).toBe("Trigger 2 is the same, but checks signer-manager.");
	});

	test("other differences name the changed fields", () => {
		const pair = [
			t({ type: "stx_burn", sender: ADDR }),
			t({ type: "stx_burn", sender: ADDR, minAmount: "1000000" }),
		];
		expect(describeTrigger(pair[0] as ChainTrigger, 0, pair).tail).toBe(
			"Trigger 2 is the same, but with minAmount changed.",
		);
	});

	test("an unfiltered trigger states its cost, with the daily volume when known", () => {
		const trigger = t({ type: "print_event" });
		expect(describeTrigger(trigger, 0, [trigger], 172000).tail).toBe(
			"No filters, so each one is delivered and billed: about 172,000 a day.",
		);
		expect(describeTrigger(trigger, 0, [trigger]).tail).toBe(
			"No filters, so each one is delivered and billed.",
		);
	});
});

describe("focus cap", () => {
	test("past four conditions the rest fold into one 'more' link", () => {
		const trigger = t({
			type: "print_event",
			contractId: POX5,
			topic: "stake",
			trait: "sip-010",
			where: { a: "1", b: "2" },
		});
		const d = describeTrigger(trigger, 0, [trigger]);
		const focus = d.prose.filter((s) => s.focus);
		expect(focus).toHaveLength(4);
		expect(focus[3]?.focus).toBe("more");
		expect(text(focus[3]?.pieces ?? [])).toBe("and 2 more conditions");
		expect(d.source).toContain("// !ref(1:1) more");
		expect(text(d.line)).toContain("with topic stake");
	});
});

describe("source", () => {
	test("a helper trigger prints annotated rows", () => {
		expect(
			describeTrigger(fastpool[0] as ChainTrigger, 0, fastpool).source,
		).toBe(
			[
				"    trigger.printEvent({",
				"      // !ref(1:1) contractId",
				`      contractId: "${POX5}",`,
				"      where: {",
				"        // !ref(1:4) where.signer",
				"        signer: [",
				`          "${FP1}",`,
				`          "${FP2}",`,
				"        ],",
				"      },",
				"    }),",
			].join("\n"),
		);
	});

	test("a type with no helper prints a plain object literal", () => {
		const trigger = t({
			type: "var_set",
			contractId: VAULT,
			varName: "paused",
		});
		const { source } = describeTrigger(trigger, 0, [trigger]);
		expect(source).toContain('type: "var_set"');
		expect(source).not.toContain("trigger.");
	});

	test("webhookSource numbers where each trigger starts and carries no annotations", () => {
		const { text: full, starts } = webhookSource({
			name: "fastpool-pox5-test",
			url: "https://postman-echo.com/post",
			triggers: fastpool,
		});
		expect(starts).toEqual([7, 16]);
		expect(full).not.toContain("!ref");
		expect(full.split("\n")[6]).toBe("    trigger.printEvent({");
	});
});

describe("agentPrompt", () => {
	const webhook = {
		id: "1d2e693a-080b-464a-b5a1-eda3c763af78",
		name: "fastpool-pox5-test",
		status: "active",
		format: "standard-webhooks",
		url: "https://postman-echo.com/post",
		maxRetries: 7,
		timeoutMs: 10000,
		concurrency: 4,
		createdAt: "2026-10-15T09:00:00.000Z",
		lastDeliveryAt: "2026-10-16T17:39:14.000Z",
		triggers: fastpool,
	} as unknown as WebhookDetail;

	test("carries the ask, the id, the update command, the height and the trigger JSON", () => {
		const prompt = agentPrompt(webhook, 9229458);
		expect(prompt).toContain(
			"Ask me what I want to change before you run anything",
		);
		expect(prompt).toContain(webhook.id);
		expect(prompt).toContain(`secondlayer webhooks update ${webhook.id}`);
		expect(prompt).toContain("Stacks height when copied: 9,229,458");
		expect(prompt).toContain("created: Oct 15, 2026");
		expect(prompt).toContain("last delivery: Oct 16 17:39 UTC");
		expect(prompt).toContain("Triggers (either one fires)");
		expect(prompt).toContain(JSON.stringify(fastpool, null, 2));
	});

	test("an unknown height and no deliveries read plainly", () => {
		const prompt = agentPrompt(
			{
				...webhook,
				lastDeliveryAt: null,
				triggers: [fastpool[0] as ChainTrigger],
			},
			null,
		);
		expect(prompt).toContain("Stacks height when copied: unknown");
		expect(prompt).toContain("last delivery: none yet");
		expect(prompt).toContain("Triggers\n1. print_event:");
	});
});
