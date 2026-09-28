import { describe, expect, test } from "bun:test";
import type { ChainTrigger, WebhookActivity } from "@secondlayer/sdk";
import {
	CHAIN_TRIGGER_FIELDS,
	CHAIN_TRIGGER_TYPES,
} from "@secondlayer/sdk/webhooks/triggers";
import {
	SENTENCE_FIELD_ORDER,
	TRIGGER_NOUN,
	chainEventType,
	filterClauseWords,
	formatTriggerAmount,
	setTriggerFields,
	triggerFieldCondition,
	triggerSentence,
	triggerVolume,
	unfilteredTriggers,
	unsetTriggerFields,
} from "./config-card";

describe("TRIGGER_NOUN coverage", () => {
	test("names every chain-trigger type — `Record<ChainTriggerType, string>` already makes a missing one a compile error, this is the runtime belt", () => {
		expect(Object.keys(TRIGGER_NOUN).sort()).toEqual(
			[...CHAIN_TRIGGER_TYPES].sort(),
		);
	});
});

describe("SENTENCE_FIELD_ORDER coverage", () => {
	test("has a phrase slot for every field any trigger type accepts", () => {
		const orderedFields: string[] = [...SENTENCE_FIELD_ORDER];
		const allFields = new Set(Object.values(CHAIN_TRIGGER_FIELDS).flat());
		for (const field of allFields) {
			expect(orderedFields).toContain(field);
		}
	});
});

describe("formatTriggerAmount", () => {
	test("STX types divide by 1e6 and label STX", () => {
		const t: ChainTrigger = { type: "stx_transfer" };
		expect(formatTriggerAmount(t, "1000000")).toBe("1 STX");
		expect(formatTriggerAmount(t, 2_500_000)).toBe("2.5 STX");
	});

	test("the sBTC token asset shows sats plus sBTC", () => {
		const t: ChainTrigger = {
			type: "ft_transfer",
			assetIdentifier:
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
		};
		expect(formatTriggerAmount(t, "100000")).toBe("100,000 sats (0.001 sBTC)");
	});

	test("every other FT shows raw base units", () => {
		const t: ChainTrigger = {
			type: "ft_transfer",
			assetIdentifier: "SP000000000000000000002Q6VF78.some-other-token::token",
		};
		expect(formatTriggerAmount(t, "42")).toBe("42 base units");
	});
});

describe("triggerFieldCondition", () => {
	test("minAmount/maxAmount read as at-least/at-most with a formatted amount", () => {
		const t: ChainTrigger = { type: "stx_transfer" };
		expect(triggerFieldCondition(t, "minAmount", "1000000")).toEqual({
			op: "at least",
			text: "1 STX",
		});
		expect(triggerFieldCondition(t, "maxAmount", "5000000")).toEqual({
			op: "at most",
			text: "5 STX",
		});
	});

	test("principal-shaped fields are shortened", () => {
		const t: ChainTrigger = {
			type: "stx_transfer",
			sender: "SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP",
		};
		const { op, text } = triggerFieldCondition(t, "sender", t.sender);
		expect(op).toBe("is");
		expect(text).toBe("SP21YT…EFFP");
	});

	test("trait reads as implements, plain fields read as-is", () => {
		const t: ChainTrigger = { type: "print_event", topic: "reward-cycle-paid" };
		expect(triggerFieldCondition(t, "trait", "sip-010")).toEqual({
			op: "implements",
			text: "sip-010",
		});
		expect(triggerFieldCondition(t, "topic", t.topic)).toEqual({
			op: "is",
			text: "reward-cycle-paid",
		});
	});
});

describe("triggerSentence", () => {
	test("builds a plain sentence from the trigger's set fields, in reading order", () => {
		const t: ChainTrigger = {
			type: "stx_transfer",
			sender: "SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP",
			minAmount: "1000000",
		};
		expect(triggerSentence(t)).toBe(
			"Any STX transfer sent by SP21YT…EFFP of 1 STX or more",
		);
	});

	test("an unfiltered trigger still reads as a bare noun sentence", () => {
		const t: ChainTrigger = { type: "stx_transfer" };
		expect(triggerSentence(t)).toBe("Any STX transfer");
	});

	test("covers a non-amount, non-principal type end to end", () => {
		const t: ChainTrigger = {
			type: "contract_deploy",
			deployer: "SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP",
			contractName: "pox-5",
		};
		expect(triggerSentence(t)).toBe(
			"Any contract deploy deployed by SP21YT…EFFP named pox-5",
		);
	});

	test("a Runes trigger (chain=bitcoin, plan 060) reads a plain sentence too", () => {
		const t: ChainTrigger = {
			type: "rune_transfer",
			rune: "840000:3",
			address: "bc1qexampleexampleexample",
			minAmount: "1000",
		};
		expect(triggerSentence(t)).toBe(
			"Any rune transfer of 840000:3 to bc1qex…mple of 1,000 base units or more",
		);
	});
});

describe("setTriggerFields / unsetTriggerFields", () => {
	test("split a trigger's own field list into set and unset, from CHAIN_TRIGGER_FIELDS", () => {
		const t: ChainTrigger = { type: "stx_transfer", sender: "SP1" };
		expect(setTriggerFields(t)).toEqual(["sender"]);
		expect(unsetTriggerFields(t)).toEqual([
			"recipient",
			"minAmount",
			"maxAmount",
		]);
	});
});

describe("filterClauseWords — subgraph filter operators in words", () => {
	test("a bare value is an implicit eq", () => {
		expect(filterClauseWords("SP1")).toEqual({ op: "is", text: "SP1" });
	});

	test("every operator reads as words", () => {
		expect(filterClauseWords({ eq: "x" })).toEqual({ op: "is", text: "x" });
		expect(filterClauseWords({ neq: "x" })).toEqual({
			op: "is not",
			text: "x",
		});
		expect(filterClauseWords({ gt: 5 })).toEqual({
			op: "greater than",
			text: "5",
		});
		expect(filterClauseWords({ gte: 5 })).toEqual({
			op: "at least",
			text: "5",
		});
		expect(filterClauseWords({ lt: 5 })).toEqual({
			op: "less than",
			text: "5",
		});
		expect(filterClauseWords({ lte: 5 })).toEqual({ op: "at most", text: "5" });
	});

	test('`in` lists shortened values; `neq ""` reads as is-not-empty', () => {
		expect(
			filterClauseWords({
				in: ["SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP", "SP2"],
			}),
		).toEqual({ op: "is one of", text: "SP21YT…EFFP, SP2" });
		expect(filterClauseWords({ neq: "" })).toEqual({
			op: "is not",
			text: "empty",
		});
	});
});

describe("per-trigger volume", () => {
	function activity(byEventType: Record<string, number>): WebhookActivity {
		return {
			hours: [],
			waiting: 0,
			nextAttemptAt: null,
			lastSuccessAt: null,
			byEventType,
		};
	}

	test("chainEventType maps a trigger type to its outbox event_type", () => {
		expect(chainEventType("stx_transfer")).toBe("chain.stx_transfer.apply");
	});

	test("reads the 7-day count for the trigger's own event type", () => {
		const t: ChainTrigger = { type: "stx_transfer" };
		const result = triggerVolume(
			t,
			[t],
			activity({ "chain.stx_transfer.apply": 38412 }),
		);
		expect(result).toEqual({ count: 38412, shared: false });
	});

	test("two triggers of the same type share one count and are flagged shared", () => {
		const a: ChainTrigger = { type: "stx_transfer", sender: "SP1" };
		const b: ChainTrigger = { type: "stx_transfer", sender: "SP2" };
		const act = activity({ "chain.stx_transfer.apply": 100 });
		expect(triggerVolume(a, [a, b], act)).toEqual({ count: 100, shared: true });
		expect(triggerVolume(b, [a, b], act)).toEqual({ count: 100, shared: true });
	});

	test("no activity yet reads as zero, not a crash", () => {
		const t: ChainTrigger = { type: "stx_transfer" };
		expect(triggerVolume(t, [t], null)).toEqual({ count: 0, shared: false });
	});
});

describe("unfilteredTriggers", () => {
	test("finds every trigger with no fields set", () => {
		const filtered: ChainTrigger = { type: "stx_transfer", sender: "SP1" };
		const open: ChainTrigger = { type: "print_event" };
		expect(unfilteredTriggers([filtered, open])).toEqual([open]);
	});

	test("none unfiltered reads as an empty list", () => {
		const filtered: ChainTrigger = { type: "stx_transfer", sender: "SP1" };
		expect(unfilteredTriggers([filtered])).toEqual([]);
	});
});
