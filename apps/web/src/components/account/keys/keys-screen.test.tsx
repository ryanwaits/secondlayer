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

const { KeysTable, RevokeConfirm } = await import("./keys-screen");

const NOW = new Date("2026-10-15T12:00:00.000Z");
const hoursFromNow = (h: number) =>
	new Date(NOW.getTime() + h * 3_600_000).toISOString();
const daily = (value: number) => new Array<number>(30).fill(value);

const key = (patch: Partial<ApiKey>): ApiKey => ({
	id: "k",
	prefix: "sk-sl_abc12345",
	name: "a key",
	status: "active",
	product: "account",
	tier: null,
	createdAt: hoursFromNow(-24 * 100),
	lastUsedAt: hoursFromNow(-2),
	rows30d: 1200,
	rowsDaily: daily(40),
	...patch,
});

const render = (keys: ApiKey[] | null, extra = {}) =>
	renderToStaticMarkup(<KeysTable keys={keys} now={NOW} {...extra} />);

describe("KeysTable", () => {
	test("has the columns name, key, rows, count and last read", () => {
		const html = render([key({ id: "a" })]);
		for (const head of ["Name", "Key", "Rows · 30d", "Count", "Last read"]) {
			expect(html).toContain(`>${head}</span>`);
		}
	});

	test("shows a count, a sparkline and when the key was last read", () => {
		const html = render([key({ id: "a", rows30d: 12_400 })]);
		expect(html).toContain("12k");
		expect(html).toContain("dc-svg");
		expect(html).toContain("2h");
	});

	test("a key with no reads says so in place of a sparkline", () => {
		const html = render([key({ id: "a", rowsDaily: daily(0), rows30d: 0 })]);
		expect(html).toContain("no reads");
		expect(html).not.toContain("dc-svg");
	});

	test("an older API without rowsDaily still shows the count", () => {
		const html = render([
			key({ id: "a", rowsDaily: undefined, rows30d: 5_000 }),
		]);
		expect(html).toContain("5k");
		expect(html).not.toContain("dc-svg");
	});

	test("a key unused for 40 days gets a yellow dot and the days", () => {
		const html = render([
			key({
				id: "old",
				name: "old-indexer",
				lastUsedAt: hoursFromNow(-24 * 40),
			}),
		]);
		expect(html).toContain("dash-dot hi");
		expect(html).toContain("Unused for 40 days");
	});

	test("a docs key shows its expiry and that it is read-only", () => {
		const html = render([
			key({ id: "d", product: "docs", expiresAt: hoursFromNow(4) }),
		]);
		expect(html).toContain("Expires in 4h · read-only");
	});

	test("an ordinary key shows when it was created", () => {
		const html = render([key({ createdAt: "2026-07-04T00:00:00.000Z" })]);
		expect(html).toContain("Created Jul 4, 2026");
	});

	test("a key made a moment ago comes first with a dot and waits for its first read", () => {
		const html = render(
			[
				key({ id: "a", name: "older", prefix: "sk-sl_aaaaaaaa" }),
				key({
					id: "n",
					name: "fresh-one",
					prefix: "sk-sl_nnnnnnnn",
					createdAt: hoursFromNow(-1),
					lastUsedAt: null,
				}),
			],
			{ freshPrefix: "sk-sl_nnnnnnnn" },
		);
		expect(html.indexOf("fresh-one")).toBeLessThan(html.indexOf("older"));
		expect(html).toContain("ky-new");
		expect(html).toContain("Waiting for its first read");
	});

	test("made-for-you keys are one collapsed row with no Revoke and no keys listed", () => {
		const html = render([
			key({ id: "t", name: "stack-key", product: "tenant" }),
			key({ id: "s", name: "watcher", product: "sentinel" }),
			key({ id: "a", name: "my-key" }),
		]);
		expect(html).toContain("2 keys made for you · can&#x27;t be revoked here");
		expect(html).not.toContain("stack-key");
		expect(html).not.toContain(">Revoke<");
	});

	test("opening the made-for-you row lists each key with its reason", () => {
		const html = render(
			[key({ id: "t", name: "stack-key", product: "tenant" })],
			{ madeOpen: true },
		);
		expect(html).toContain("stack-key");
		expect(html).toContain("Your hosted stack reads the chain with it.");
		expect(html).toContain("Your hosted stack");
	});

	test("yours come before the ones made for you, and revoked keys are hidden", () => {
		const html = render(
			[
				key({ id: "t", name: "stack-key", product: "tenant" }),
				key({ id: "a", name: "my-key" }),
				key({ id: "r", name: "gone-key", status: "revoked" }),
			],
			{ madeOpen: true },
		);
		expect(html.indexOf("my-key")).toBeLessThan(html.indexOf("stack-key"));
		expect(html).not.toContain("gone-key");
	});

	test("an open key shows its chart link, its details and Revoke", () => {
		const html = render([key({ id: "a", name: "laptop" })], {
			initialOpen: "a",
		});
		expect(html).toContain("Rows ›");
		expect(html).toContain("/account/rows");
		expect(html).toContain("Rows · 30 days");
		expect(html).toContain("Last read");
		expect(html).toContain(
			"Stops working at once. Anything using it gets a 401.",
		);
		expect(html).toContain(">Revoke<");
	});

	test("an open docs key explains itself instead of offering Revoke", () => {
		const html = render(
			[key({ id: "d", product: "docs", expiresAt: hoursFromNow(4) })],
			{ initialOpen: "d" },
		);
		expect(html).toContain("Signs the code samples in the docs");
		expect(html).not.toContain(">Revoke<");
	});

	test("ends with the faint note about revoked and lost keys", () => {
		expect(render([key({ id: "a" })])).toContain(
			"Lost a key? Revoke it and make another: we only ever show a key once.",
		);
	});
});

describe("RevokeConfirm", () => {
	test("says what happens and that it can't be undone", () => {
		const html = renderToStaticMarkup(
			<RevokeConfirm k={key({ name: "laptop" })} onDone={() => {}} />,
		);
		expect(html).toContain("Revoke laptop?");
		expect(html).toContain(
			"Anything using it gets a 401 at once. You can&#x27;t undo this; you can make a new key.",
		);
		expect(html).toContain("acct-btn danger");
		expect(html).toContain("Cancel");
	});
});
