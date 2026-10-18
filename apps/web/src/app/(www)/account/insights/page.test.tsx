import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({ replace: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { default: InsightsPage } = await import("./page");

describe("account insights page", () => {
	test("renders nothing on the server, so desktop never gets an insights list", () => {
		expect(renderToStaticMarkup(<InsightsPage />)).toBe("");
	});
});
