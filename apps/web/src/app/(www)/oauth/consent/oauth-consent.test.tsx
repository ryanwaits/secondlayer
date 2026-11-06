import { describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({ replace: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { REQUEST_ID_RE } = await import("./oauth-consent");

describe("OauthConsentCard", () => {
	test("request ids are checked before anything is fetched", () => {
		expect(REQUEST_ID_RE.test("oar_abc-DEF_123")).toBe(true);
		expect(REQUEST_ID_RE.test("oar_")).toBe(false);
		expect(REQUEST_ID_RE.test("../keys")).toBe(false);
		expect(REQUEST_ID_RE.test("oar_a/b")).toBe(false);
	});
});
