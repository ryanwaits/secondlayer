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

describe("updates signup for a reader already on the list", () => {
	test("a confirmed reader sees one line with an unsubscribe link, not the form", async () => {
		const html = await renderAsync(
			<UpdatesSignup
				known={{ status: "confirmed", email: "a@b.co", token: "tok/1" }}
			/>,
		);
		expect(html).toContain("a@b.co");
		expect(html).toContain("/updates/unsubscribe?t=tok%2F1");
		expect(html).not.toContain('type="email"');
		expect(html).not.toContain("<h3");
	});

	test("a pending reader is pointed at the confirmation email", async () => {
		const html = await renderAsync(
			<UpdatesSignup known={{ status: "pending", email: "a@b.co" }} />,
		);
		expect(html).toContain("Check a@b.co for the confirmation link");
		expect(html).toContain("Use another address");
		expect(html).not.toContain('type="email"');
	});
});
