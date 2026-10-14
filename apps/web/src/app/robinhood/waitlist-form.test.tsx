import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { checkedRadios } from "../../lib/test-render";
import { WaitlistForm } from "./waitlist-form";

describe("waitlist form", () => {
	const html = renderToStaticMarkup(<WaitlistForm />);

	test("submits the role as a form field, builder preselected", () => {
		expect(checkedRadios(html)).toEqual({ role: "builder" });
	});

	test("offers every role the API accepts under that field", () => {
		for (const role of ["builder", "holder", "issuer"]) {
			expect(html).toMatch(
				new RegExp(`<input[^>]*name="role"[^>]*value="${role}"`),
			);
		}
	});

	test("the visible label names the role group", () => {
		expect(html).toContain('id="role-label"');
		expect(html).toContain('aria-labelledby="role-label"');
	});
});
