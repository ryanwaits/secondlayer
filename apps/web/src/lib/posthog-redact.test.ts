import { describe, expect, test } from "bun:test";
import { redactKeys } from "./posthog-redact";

const KEY = `sk-sl_${"a1b2c3d4".repeat(4)}`;

describe("redactKeys", () => {
	test("an API key in any string of an event is replaced", () => {
		const event = {
			event: "$autocapture",
			properties: {
				$el_text: `Bearer ${KEY}`,
				$elements: [{ text: KEY, attr__href: `/x?k=${KEY}` }],
				$exception_list: [{ value: `failed with ${KEY}` }],
			},
		};
		const out = JSON.stringify(redactKeys(event));
		expect(out).not.toContain(KEY);
		expect(out).not.toContain("a1b2c3d4");
		expect(out).toContain("sk-sl_[redacted]");
	});

	test("a Sentinel key is replaced too", () => {
		const out = JSON.stringify(redactKeys({ t: `sk-snt_${"0f".repeat(16)}` }));
		expect(out).not.toContain("0f0f");
	});

	test("an event's Date timestamp survives intact", () => {
		const timestamp = new Date("2026-10-15T01:00:00Z");
		const out = redactKeys({ event: "$pageview", timestamp, properties: {} });
		expect(out.timestamp).toBe(timestamp);
		expect(JSON.parse(JSON.stringify(out)).timestamp).toBe(
			"2026-10-15T01:00:00.000Z",
		);
	});

	test("text that only looks similar is left alone", () => {
		const event = { t: "sk-sl_…ab12 and $SECONDLAYER_API_KEY", n: 3, b: null };
		expect(redactKeys(event)).toEqual(event);
	});
});
