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

	test("request ids are checked before anything is fetched", () => {
		expect(REQUEST_ID_RE.test("oar_abc-DEF_123")).toBe(true);
		expect(REQUEST_ID_RE.test("oar_")).toBe(false);
		expect(REQUEST_ID_RE.test("../keys")).toBe(false);
		expect(REQUEST_ID_RE.test("oar_a/b")).toBe(false);
	});
});
