import { describe, expect, mock, test } from "bun:test";
import { renderAsync } from "@/lib/test-render";

// bun's mock.module is process-wide; the signed-in case flips this value.
let account: { email: string } | null = null;
mock.module("@/lib/auth", () => ({
	useAuth: () => ({ account, loading: false }),
}));

const { UpdatesSignup } = await import("./updates-signup");

describe("updates signup", () => {
	test("idle state is an email form with a honeypot", async () => {
		account = null;
		const html = await renderAsync(<UpdatesSignup />);
		expect(html).toContain('id="updates"');
		expect(html).toContain('type="email"');
		expect(html).toContain("Subscribe");
		expect(html).toContain('name="website"');
		expect(html).toContain("<h3");
	});

	test("the blog index variant uses an h2", async () => {
		account = null;
		const html = await renderAsync(<UpdatesSignup heading />);
		expect(html).toContain("<h2");
	});

	test("a signed-in reader gets their address pre-filled", async () => {
		account = { email: "a@b.co" };
		const html = await renderAsync(<UpdatesSignup />);
		expect(html).toContain('value="a@b.co"');
	});

	test("copy has no em dashes", async () => {
		account = null;
		const html = await renderAsync(<UpdatesSignup heading />);
		expect(html).not.toContain("—");
	});
});
