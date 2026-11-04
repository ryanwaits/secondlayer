import { describe, expect, test } from "bun:test";
import type { WebhookDeliveryDetail } from "@secondlayer/sdk";
import {
	codeLabel,
	deliveryCopyText,
	deliveryFields,
	plainLine,
	statusSuffix,
} from "./delivery-view";
import { attempt } from "./webhook.fixtures";

// A real print event, as the webhook delivers it.
const SENT = {
	event: {
		data: {
			topic: "print",
			value: {
				topic: "stake",
				signer:
					"SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager",
				staker: "SP30Y2VTMG79TVATT1KGHCPHQE7WJMBZR2ZHW71FG",
				"num-cycles": "96",
				"amount-ustx": "120885000000",
			},
			raw_value: `0x0c000000080b616d6f756e7${"4".repeat(504)}000000000f3`,
			contract_id: "SP000000000000000000002Q6VF78.pox-5",
		},
		type: "contract_event",
		tx_id: "0xd149849b02639c2b280be6d467936ea290af5c9490635ed669b94208bf7855cd",
		event_index: 664,
	},
	tx_id: "0xd149849b02639c2b280be6d467936ea290af5c9490635ed669b94208bf7855cd",
	action: "apply",
	trigger: "print_event",
	block_hash:
		"0x5c46b13584edbe7ab415995321dba52884129da40c6a83bd3a1a2e1bba74a190",
	block_time: "2026-11-04T14:45:49.000Z",
	block_height: 9411529,
};

function detailOf(
	over: Partial<WebhookDeliveryDetail> = {},
): WebhookDeliveryDetail {
	return {
		id: "d_last",
		attempt: 1,
		statusCode: 200,
		durationMs: 120,
		dispatchedAt: "2026-11-04T14:45:50.000Z",
		errorMessage: null,
		responseBody: '{"ok":true}',
		responseHeaders: null,
		outboxId: null,
		outboxStatus: "delivered",
		eventType: "print_event",
		txId: SENT.tx_id,
		blockHeight: 9411529,
		blockTime: SENT.block_time,
		eventIndex: 664,
		payload: SENT,
		...over,
	};
}

const copyBase = {
	webhookName: "fastpool-pox5-test",
	host: "postman-echo.com",
};

const firstTry = [attempt({ id: "d_last", responseBody: '{"ok":true}' })];

const gaveUp = [1, 2, 3, 4, 5].map((n) =>
	attempt({
		id: `d_${n}`,
		attempt: n,
		statusCode: 503,
		errorMessage: "upstream connect error or disconnect/reset",
		durationMs: 30 + n,
		responseBody: n === 5 ? "upstream connect error" : null,
		dispatchedAt: `2026-11-04T14:4${n}:00.000Z`,
	}),
);

describe("statusSuffix", () => {
	test("a single attempt has no suffix", () => {
		expect(statusSuffix([attempt()])).toBeNull();
	});

	test("three attempts say 3 tries", () => {
		expect(
			statusSuffix([
				attempt({ id: "a1", attempt: 1 }),
				attempt({ id: "a2", attempt: 2 }),
				attempt({ id: "a3", attempt: 3 }),
			]),
		).toBe("3 tries");
	});

	test("the true attempt number wins when the list was cut short", () => {
		expect(
			statusSuffix([
				attempt({ id: "a7", attempt: 7 }),
				attempt({ id: "a8", attempt: 8 }),
			]),
		).toBe("8 tries");
	});
});

describe("codeLabel", () => {
	test("a missing status code reads as timeout", () => {
		expect(codeLabel({ statusCode: null })).toBe("timeout");
		expect(codeLabel({ statusCode: 502 })).toBe("502");
	});
});

describe("deliveryFields", () => {
	const fields = deliveryFields(SENT);

	test("decoded print keys come first, unprefixed and ungrouped", () => {
		expect(fields.slice(0, 5).map((f) => f.key)).toEqual([
			"topic",
			"signer",
			"staker",
			"num-cycles",
			"amount-ustx",
		]);
		expect(fields.slice(0, 5).every((f) => f.group === null)).toBe(true);
	});

	test("the Event group holds where the event came from", () => {
		const event = fields.filter((f) => f.group === "Event");
		expect(event.map((f) => f.key)).toEqual([
			"topic",
			"raw_value",
			"contract_id",
			"trigger",
			"block time",
		]);
		expect(event.find((f) => f.key === "block time")?.value).toBe(
			"14:45:49 UTC",
		);
		expect(event.find((f) => f.key === "trigger")?.value).toBe("print_event");
	});

	test("a delivery wrapped in a type/data envelope reads the same", () => {
		expect(
			deliveryFields({ type: "chain.print_event.apply", data: SENT }),
		).toEqual(fields);
	});

	test("event data that is not a print flattens with dotted keys", () => {
		const out = deliveryFields({
			event: {
				data: {
					sender: "SP1",
					memo: null,
					tags: ["a", "b"],
					amount: 5,
					nested: { deep: { ok: true } },
				},
			},
		});
		expect(out).toEqual([
			{ group: null, key: "sender", value: "SP1" },
			{ group: null, key: "memo", value: "null" },
			{ group: null, key: "tags", value: '["a","b"]' },
			{ group: null, key: "amount", value: "5" },
			{ group: null, key: "nested.deep.ok", value: "true" },
		]);
	});

	test("a payload without event data has no fields", () => {
		expect(deliveryFields({ event: {} })).toEqual([]);
		expect(deliveryFields(null)).toEqual([]);
		expect(deliveryFields("text")).toEqual([]);
	});
});

describe("plainLine", () => {
	test("braces, backticks, tags and arrows are flattened and long text is cut", () => {
		expect(plainLine('<b>bad</b> {"a": `x`} => $y')).toBe('bad "a": x -> y');
		expect(plainLine("a".repeat(100), 20)).toBe(`${"a".repeat(19)}...`);
		expect(plainLine(null)).toBe("");
	});
});

describe("deliveryCopyText", () => {
	test("a first-try delivery says so and lists no attempts or finding", () => {
		const text = deliveryCopyText({
			...copyBase,
			attempts: firstTry,
			detail: detailOf(),
			finding: null,
		});
		expect(text).toContain("Result    200 in 120 ms, first try");
		expect(text).toContain("Webhook   fastpool-pox5-test → postman-echo.com");
		expect(text).toContain("block 9,411,529");
		expect(text).toContain("#664");
		expect(text).not.toContain("Attempts");
		expect(text).not.toContain("Finding");
		expect(text).toContain("Payload\n{");
		expect(text).toContain('Response (200)\n{\n  "ok": true\n}');
	});

	test("a delivery that gave up leads with it, the finding and the resend line", () => {
		const text = deliveryCopyText({
			...copyBase,
			attempts: gaveUp,
			detail: detailOf({
				statusCode: 503,
				outboxStatus: "dead",
				outboxId: "ob_123",
			}),
			finding: "fastpool-pox5-test has failed 5 deliveries in a row",
		});
		expect(text.startsWith("Gave up after 5 attempts; held for resend.")).toBe(
			true,
		);
		expect(text).toContain("First failure: 503 upstream connect error");
		expect(text).toContain(
			"Finding: fastpool-pox5-test has failed 5 deliveries in a row",
		);
		expect(text).toContain("sl webhooks requeue fastpool-pox5-test ob_123");
		expect(text).toContain("  3  503     33 ms");
	});

	test("a delivery still retrying says so and offers no resend", () => {
		const text = deliveryCopyText({
			...copyBase,
			attempts: gaveUp.slice(0, 2),
			detail: detailOf({ statusCode: 503, outboxStatus: "pending" }),
			finding: null,
		});
		expect(text).toContain("Failing after 2 attempts; still retrying.");
		expect(text).not.toContain("Resend");
	});

	test("a delivery that recovered says which try worked", () => {
		const text = deliveryCopyText({
			...copyBase,
			attempts: [
				attempt({ id: "a1", attempt: 1, statusCode: 502 }),
				attempt({ id: "a2", attempt: 2, statusCode: 200 }),
			],
			detail: detailOf(),
			finding: null,
		});
		expect(text).toContain("Delivered on try 2 after 1 failures.");
	});

	test("the copy is evidence only and never asks an agent for anything", () => {
		for (const attempts of [firstTry, gaveUp]) {
			const text = deliveryCopyText({
				...copyBase,
				attempts,
				detail: detailOf({ outboxStatus: "dead", outboxId: "ob_1" }),
				finding: "the receiver looks down",
			});
			expect(text).not.toContain("doctor");
			expect(text).not.toContain("help me");
		}
	});

	test("a non-JSON response body is flattened to a plain line", () => {
		const text = deliveryCopyText({
			...copyBase,
			attempts: [
				attempt({
					id: "a1",
					statusCode: 500,
					responseBody: "<p>{oops} `bad`</p>",
				}),
			],
			detail: null,
			finding: null,
		});
		expect(text).toContain("Response (500)\noops bad");
		expect(text).not.toContain("`");
	});

	test("with no response on any attempt the copy says what happened instead", () => {
		const text = deliveryCopyText({
			...copyBase,
			attempts: [
				attempt({
					statusCode: null,
					errorMessage: "timed out after 10s",
					responseBody: null,
				}),
			],
			detail: null,
			finding: null,
		});
		expect(text).toContain("Response\n  none: timed out after 10s");
	});
});
