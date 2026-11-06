import { describe, expect, mock, test } from "bun:test";
import { PRODUCTS } from "@/lib/site";
import { renderAsync } from "@/lib/test-render";
import { CHAIN_TRIGGER_TYPES } from "../../../../../packages/shared/src/schemas/webhooks";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { default: WebhooksPage } = await import("./p/webhooks/page");

describe("product routes", () => {
	test("every product lives under /p so no route shadows the home page", () => {
		for (const product of PRODUCTS) {
			expect(product.href.startsWith("/p/")).toBe(true);
			expect(product.href).not.toBe("/index");
		}
	});
});

describe("product pages", () => {
	test("webhooks page trigger count matches the chain trigger schema", async () => {
		const html = await renderAsync(<WebhooksPage />);
		expect(html).toContain(`${CHAIN_TRIGGER_TYPES.length} triggers`);
	});
});
