import { describe, expect, test } from "bun:test";
import { confirmEmail, unsubscribeFor } from "./updates.ts";

describe("unsubscribeFor", () => {
	test("returns the web link and both one-click headers", () => {
		const { url, headers } = unsubscribeFor("tok_en+/=");
		expect(url).toBe(
			"https://www.secondlayer.tools/updates/unsubscribe?t=tok_en%2B%2F%3D",
		);
		expect(headers).toEqual({
			"List-Unsubscribe":
				"<https://api.secondlayer.tools/api/public/updates/unsubscribe?t=tok_en%2B%2F%3D>",
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		});
	});
});

describe("confirmEmail", () => {
	test("links to the confirm page and carries no unsubscribe", () => {
		const { subject, html, text } = confirmEmail("abc123");
		expect(subject).toBe("Confirm your secondlayer subscription");
		const url = "https://www.secondlayer.tools/updates/confirm?t=abc123";
		expect(html).toContain(url);
		expect(text).toContain(url);
		expect(html).not.toContain("Unsubscribe");
		expect(text).not.toContain("Unsubscribe");
	});
});
