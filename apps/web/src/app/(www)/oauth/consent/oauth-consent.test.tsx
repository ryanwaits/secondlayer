import { describe, expect, mock, test } from "bun:test";
import { renderAsync } from "@/lib/test-render";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({ replace: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { OauthConsentCard, REQUEST_ID_RE } = await import("./oauth-consent");

const noop = () => {};
const props = {
	email: "ryan@example.com",
	busy: false,
	error: null,
	onAllow: noop,
	onDeny: noop,
};
const review = (clientName: string, redirectHost = "127.0.0.1:53682") =>
	({ kind: "review", clientName, redirectHost }) as const;

describe("OauthConsentCard", () => {
	test("review names the app as unverified, the account, the redirect host and the balance", async () => {
		const html = await renderAsync(
			<OauthConsentCard
				{...props}
				view={review("Claude Code")}
				balance="$12.40"
			/>,
		);
		expect(html).toContain("<strong>Claude Code</strong>");
		expect(html).toContain("(unverified)");
		expect(html).toContain("to use secondlayer as ryan@example.com?");
		expect(html).toContain("127.0.0.1:53682");
		expect(html).toContain("Reads it makes use your credits (balance $12.40).");
		expect(html).toContain(">Allow<");
		expect(html).toContain(">Deny<");
		expect(html).toContain("cannot make or revoke keys");
	});

	test("without a balance yet, the credits line still says reads are paid", async () => {
		const html = await renderAsync(
			<OauthConsentCard {...props} view={review("Claude Code")} />,
		);
		expect(html).toContain("Reads it makes use your credits.");
	});

	test("a hostile name renders as escaped plain text, one line, capped", async () => {
		const hostile = `<img src=x onerror=alert(1)>‮edoC edualC​\nsecondlayer official${"x".repeat(80)}`;
		const html = await renderAsync(
			<OauthConsentCard {...props} view={review(hostile)} />,
		);
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(html).not.toContain("‮");
		expect(html).not.toContain("​");
		expect(html).not.toContain("\n");
		expect(html).toContain("…</strong>");
		expect(html).toContain("(unverified)");
	});

	test("leaving and gone say what happened", async () => {
		const allowed = await renderAsync(
			<OauthConsentCard
				{...props}
				view={{ kind: "leaving", allowed: true, clientName: "Claude Code" }}
			/>,
		);
		expect(allowed).toContain("Returning you to Claude Code.");
		const denied = await renderAsync(
			<OauthConsentCard
				{...props}
				view={{ kind: "leaving", allowed: false, clientName: "Claude Code" }}
			/>,
		);
		expect(denied).toContain("Claude Code was told no.");
		const gone = await renderAsync(
			<OauthConsentCard {...props} view={{ kind: "gone" }} />,
		);
		expect(gone).toContain("This sign-in can&#x27;t continue.");
	});

	test("an error and a busy state are shown", async () => {
		const html = await renderAsync(
			<OauthConsentCard
				{...props}
				busy
				error="Something went wrong. Try again."
				view={review("Claude Code")}
			/>,
		);
		expect(html).toContain("Something went wrong. Try again.");
		expect(html).toContain("Allowing...");
	});

	test("request ids are checked before anything is fetched", () => {
		expect(REQUEST_ID_RE.test("oar_abc-DEF_123")).toBe(true);
		expect(REQUEST_ID_RE.test("oar_")).toBe(false);
		expect(REQUEST_ID_RE.test("../keys")).toBe(false);
		expect(REQUEST_ID_RE.test("oar_a/b")).toBe(false);
	});
});
