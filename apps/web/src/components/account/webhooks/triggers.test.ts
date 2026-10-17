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
	triggerVolume,
} from "./triggers";

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

describe("per-trigger volume", () => {
	function activity(byEventType: Record<string, number>): WebhookActivity {
		return {
			hours: [],
			waiting: 0,
			nextAttemptAt: null,
			lastSuccessAt: null,
			byEventType,
			usualByHourOfDay: null,
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
