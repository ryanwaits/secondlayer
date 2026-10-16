import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WebhooksListBody } from "./list-panel";
import { rowModel } from "./rows";
import { FIXTURE_HOURS, summary } from "./webhook.fixtures";

const series = {
	delivered: new Array<number>(168).fill(2),
	failed: new Array<number>(168).fill(0),
};
const plain = rowModel(summary(), series, FIXTURE_HOURS, []);
const managed = rowModel(
	summary({
		id: "wh_managed",
		name: "sentinel:example-watch",
		managedBy: "Sentinel",
	}),
	series,
	FIXTURE_HOURS,
	[],
);
const waiting = rowModel(
	summary({
		id: "wh_waiting",
		name: "sentinel:vault-admin",
		lastDeliveryAt: null,
		lastSuccessAt: null,
	}),
	undefined,
	FIXTURE_HOURS,
	[],
);

const noSeries = rowModel(summary(), undefined, FIXTURE_HOURS, []);

const render = (props: Partial<Parameters<typeof WebhooksListBody>[0]>) =>
	renderToStaticMarkup(
		<WebhooksListBody
			rows={[plain, managed, waiting]}
			hours={FIXTURE_HOURS}
			notice={null}
			onOpenHour={() => {}}
			{...props}
		/>,
	);

describe("WebhooksListBody", () => {
	test("heads the page and names the SDK as the way to create", () => {
		const html = render({});
		expect(html).toContain("Webhooks");
		expect(html).toContain("Chain events to your server");
		expect(html).toContain("sl webhooks");
	});

	test("a row names the webhook, its receiver host and its state", () => {
		const html = render({});
		expect(html).toContain('href="/account/webhooks/wh_deposits"');
		expect(html).toContain("sbtc-deposits");
		expect(html).toContain("hooks.example.dev");
		expect(html).toContain("Delivered 48 in 24h");
	});

	test("a Sentinel-managed webhook carries the named-by chip", () => {
		const html = render({});
		expect(html).toContain("named by Sentinel");
		expect(html.match(/named by Sentinel/g)).toHaveLength(1);
	});

	test("each row has a heat square per hour of the week", () => {
		const html = render({ rows: [plain] });
		expect(html.match(/<button[^>]*dc-heat-cell/g)).toHaveLength(168);
		expect(html).toContain("Thu, Oct 8");
	});

	test("webhooks with no match yet fold into one quiet row listing their names", () => {
		const html = render({});
		expect(html).toContain("1 waiting for a first match");
		expect(html).toContain("vault-admin");
	});

	test("the legend explains the squares", () => {
		const html = render({});
		expect(html).toContain("Delivered in that hour (darker = more)");
		expect(html).toContain("Failed");
		expect(html).toContain("Nothing");
	});

	test("no webhooks shows the empty state with the SDK docs link", () => {
		const html = render({ rows: [] });
		expect(html).toContain("No webhooks yet");
		expect(html).toContain('href="/docs/webhooks"');
		expect(html).not.toContain("dc-heat-cell");
	});

	test("a starting stack shows the notice only while there are no rows", () => {
		const waitingHtml = render({ rows: null, notice: { kind: "starting" } });
		expect(waitingHtml).toContain("Starting your hosted stack");
		const loaded = render({ notice: { kind: "starting" } });
		expect(loaded).not.toContain("Starting your hosted stack");
	});

	test("no credits offers the way to add some", () => {
		const html = render({ rows: null, notice: { kind: "no_credits" } });
		expect(html).toContain("Deliveries are paused until you add credits");
		expect(html).toContain('href="/account/credits"');
	});
});

describe("WebhooksListBody heat strip placeholder", () => {
	test("an active row holds its strip's space while the summary is pending", () => {
		const html = render({ rows: [noSeries], summaryLoaded: false });
		expect(html).toContain("dc-heat-cell s");
		expect(html).not.toMatch(/<button[^>]*dc-heat-cell/);
	});

	test("a waiting webhook never gets a strip", () => {
		const html = render({ rows: [waiting], summaryLoaded: false });
		expect(html).not.toContain("dc-heat");
	});

	test("a loaded summary with no series for the row shows no strip and no placeholder", () => {
		const html = render({ rows: [noSeries], summaryLoaded: true });
		expect(html).not.toContain("dc-heat");
	});
});

describe("WebhooksListBody for a new account", () => {
	test("the empty state shows the create call and a guide link", () => {
		const html = render({ rows: [] });
		expect(html).toContain("A webhook posts chain events to your server");
		expect(html).toContain("sl.webhooks.create");
		expect(html).toContain("Webhooks guide");
		expect(html).toContain("aria-hidden");
	});

	test("the key-first line shows only while there is no key", () => {
		expect(render({ rows: [], noKey: true })).toContain(
			"You need a key first.",
		);
		expect(render({ rows: [] })).not.toContain("You need a key first.");
	});
});
