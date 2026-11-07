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

	test("a session token is replaced", () => {
		const session = `ss-sl_${"9f".repeat(16)}`;
		const out = JSON.stringify(redactKeys({ t: `Bearer ${session}` }));
		expect(out).not.toContain("9f9f");
	});

	test("a sign-in token in a URL is replaced wherever it sits", () => {
		const token = "c0ffee".repeat(10);
		const event = {
			event: "$pageview",
			properties: {
				$current_url: `https://www.secondlayer.tools/auth/verify?token=${token}`,
				$pathname: "/auth/verify",
				$referrer: `https://x.test/a?b=1&token=${token}&c=2`,
				$el_href: `/auth/verify?utm=1#token=${token}`,
			},
		};
		const out = JSON.stringify(redactKeys(event));
		expect(out).not.toContain(token);
		expect(out).toContain("/auth/verify?token=[redacted]");
		expect(out).toContain("&c=2");
	});

	test("a query parameter that only ends in token is left alone", () => {
		const event = { u: "/x?csrf_token=abc&nexttoken=def" };
		expect(redactKeys(event)).toEqual(event);
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
