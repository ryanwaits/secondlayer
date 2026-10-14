import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WaitlistForm } from "./waitlist-form";

/** What the browser would put in FormData for radio inputs: name -> checked value. */
function radioFormData(html: string): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const tag of html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []) {
		const name = tag.match(/name="([^"]*)"/)?.[1];
		const value = tag.match(/value="([^"]*)"/)?.[1];
		if (name && value !== undefined && /\schecked(=""|\s|\/|>)/.test(tag)) {
			out[name] = [...(out[name] ?? []), value];
		}
	}
	return out;
}

describe("waitlist form", () => {
	const html = renderToStaticMarkup(<WaitlistForm />);

	test("submits the role as a form field, builder preselected", () => {
		expect(radioFormData(html)).toEqual({ role: ["builder"] });
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
