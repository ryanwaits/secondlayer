import { describe, expect, mock, test } from "bun:test";
import type { ApiKey } from "@/lib/types";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { KeysTable } = await import("./keys-screen");

const NOW = new Date("2026-10-15T12:00:00.000Z");
const hoursFromNow = (h: number) =>
	new Date(NOW.getTime() + h * 3_600_000).toISOString();

const key = (patch: Partial<ApiKey>): ApiKey => ({
	id: "k",
	prefix: "sl_abc",
	name: "a key",
	status: "active",
	product: "account",
	tier: null,
	createdAt: hoursFromNow(-24 * 100),
	lastUsedAt: hoursFromNow(-2),
	...patch,
});

const render = (keys: ApiKey[] | null) =>
	renderToStaticMarkup(<KeysTable keys={keys} now={NOW} />);

describe("KeysTable", () => {
	test("a key unused for 40 days says so and offers Revoke", () => {
		const html = render([
			key({
				id: "old",
				name: "old-indexer",
				lastUsedAt: hoursFromNow(-24 * 40),
			}),
		]);
		expect(html).toContain("Unused for 40 days");
		expect(html).toContain("Revoke");
		expect(html).toContain("Your key");
	});

	test("a hosted stack key shows what it is for and has no Revoke", () => {
		const html = render([key({ id: "t", name: "stack", product: "tenant" })]);
		expect(html).toContain("Your hosted stack");
		expect(html).toContain("Made for you · can&#x27;t be revoked here");
		expect(html).not.toContain("Revoke");
	});

	test("a docs key shows its expiry and that it is read-only", () => {
		const html = render([
			key({ id: "d", product: "docs", expiresAt: hoursFromNow(4) }),
		]);
		expect(html).toContain("Expires in 4h · read-only");
		expect(html).toContain("Docs samples");
	});

	test("an ordinary key shows when it was created", () => {
		const html = render([key({ createdAt: "2026-07-04T00:00:00.000Z" })]);
		expect(html).toContain("Created Jul 4, 2026");
	});

	test("yours come before the ones made for you, and revoked keys are hidden", () => {
		const html = render([
			key({ id: "t", name: "stack-key", product: "tenant" }),
			key({ id: "a", name: "my-key" }),
			key({ id: "r", name: "gone-key", status: "revoked" }),
		]);
		expect(html.indexOf("my-key")).toBeLessThan(html.indexOf("stack-key"));
		expect(html).not.toContain("gone-key");
	});

	test("says loading until the list arrives", () => {
		expect(render(null)).toContain("Loading keys...");
	});
});
