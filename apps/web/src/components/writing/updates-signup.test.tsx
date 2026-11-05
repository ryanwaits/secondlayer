import { describe, expect, test } from "bun:test";
import { renderAsync } from "@/lib/test-render";
import { UpdatesSignupForm as UpdatesSignup } from "./updates-signup";

// The form, not the session wrapper: mocking @/lib/auth would leak into every
// other test file (bun's mock.module is process-wide).

describe("updates signup", () => {
	test("idle state is an email form with a honeypot", async () => {
		const html = await renderAsync(<UpdatesSignup />);
		expect(html).toContain('id="updates"');
		expect(html).toContain('type="email"');
		expect(html).toContain("Subscribe");
		expect(html).toContain('name="website"');
		expect(html).toContain("<h3");
	});

	test("the blog index variant uses an h2", async () => {
		const html = await renderAsync(<UpdatesSignup heading />);
		expect(html).toContain("<h2");
	});

	test("a signed-in reader gets their address pre-filled", async () => {
		const html = await renderAsync(<UpdatesSignup prefill="a@b.co" />);
		expect(html).toContain('value="a@b.co"');
	});

	test("copy has no em dashes", async () => {
		const html = await renderAsync(<UpdatesSignup heading />);
		expect(html).not.toContain("—");
	});
});
