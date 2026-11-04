import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
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

	test("a row names the webhook, its receiver host and its three numbers", () => {
		const html = render({});
		expect(html).toContain('href="/account/webhooks/wh_deposits"');
		expect(html).toContain("sbtc-deposits");
		expect(html).toContain("hooks.example.dev");
		expect(html).toContain("<strong>336</strong><small>delivered, 7 days");
		expect(html).toContain("<small>failed</small>");
		expect(html).toContain("<small>since the last</small>");
	});

	test("a healthy row shows no status and never says it is delivering", () => {
		const html = render({ rows: [plain] });
		expect(html).not.toContain("ix-chip");
		expect(html).not.toContain("Delivering");
		expect(html).not.toContain("Delivered 48 in 24h");
	});

	test("one clickable row per active webhook", () => {
		const html = render({});
		expect(html.match(/class="ix-row"/g)).toHaveLength(2);
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

	test("webhooks with no match yet sit in a waiting block under the list, each a link", () => {
		const html = render({});
		expect(html).toContain("Waiting for a first match");
		expect(html).toContain('<span class="wq-n">1</span>');
		expect(html).toContain('href="/account/webhooks/wh_waiting"');
		expect(html.indexOf("None")).toBeLessThan(
			html.indexOf("Waiting for a first match"),
		);
	});

	test("the key on the list's top edge explains the squares", () => {
		const html = render({});
		expect(html).toContain("Less");
		expect(html).toContain("More");
		expect(html).toContain("Failed");
		expect(html).toContain("None");
		expect(html).not.toContain("Delivered that hour, darker is more");
	});

	test("the hour axis sits once, under the last row", () => {
		const html = render({ rows: [plain, managed] });
		expect(html.match(/dc-heat-hour/g)).toHaveLength(24);
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

const failing = rowModel(
	summary({ id: "wh_failing", name: "bns-names" }),
	{
		delivered: new Array<number>(168).fill(0),
		failed: new Array<number>(168).fill(3),
	},
	FIXTURE_HOURS,
	[],
);

describe("WebhooksListBody status and why line", () => {
	test("a failing row says Failing, shows its reading and boxes the name", () => {
		const html = render({ rows: [failing] });
		expect(html).toContain("Failing</span>");
		expect(html).toContain("ix-name bad");
		expect(html).toContain("Failing since");
	});

	test("a paused row says Paused", () => {
		const paused = rowModel(
			summary({ status: "paused" }),
			series,
			FIXTURE_HOURS,
			[],
		);
		expect(render({ rows: [paused] })).toContain("ix-dot idle");
	});

	test("an insight row shows its line without a repeat of the name", () => {
		const insight = {
			id: "i1",
			rule: "r",
			severity: "will_fail",
			impact: 1,
			resource: { kind: "webhook", id: summary().id, name: "sbtc-deposits" },
			line: "sbtc-deposits still sends to a test endpoint",
			lead: "",
			body: "",
			evidence: [],
			handoff: { prompt: "", commands: [] },
			how: { detector: "d", facts: [] },
			createdAt: "2026-10-16T00:00:00Z",
		} as Insight;
		const row = rowModel(summary(), series, FIXTURE_HOURS, [insight]);
		const html = render({ rows: [row] });
		expect(html).toContain("Still sends to a test endpoint");
		expect(html).not.toContain("sbtc-deposits still sends");
	});
});

describe("WebhooksListBody search, status and view", () => {
	const many = Array.from({ length: 4 }, (_, i) =>
		rowModel(
			summary({ id: `wh_${i}`, name: `hook-${i}` }),
			series,
			FIXTURE_HOURS,
			[],
		),
	);

	test("three webhooks show no search, four do", () => {
		expect(render({ rows: many.slice(0, 3) })).not.toContain('id="index-q"');
		const html = render({ rows: many });
		expect(html).toContain('id="index-q"');
		expect(html).toContain("Status");
		expect(html).toContain("4 webhooks");
	});

	test("the view switch is always there", () => {
		const html = render({ rows: [plain] });
		expect(html).toContain('aria-label="Rows"');
		expect(html).toContain('aria-label="Ribbon"');
		expect(html).toContain("1 webhook<");
	});

	test("Ribbon draws one strip per row with no clickable hours", () => {
		const html = render({ rows: many, initialView: "ribbon" });
		expect(html).toContain("ix-ribbon");
		expect(html).toContain("ix-days");
		expect(html).toContain("· UTC");
		expect(html.match(/class="ix-strip"/g)).toHaveLength(4);
		expect(html).not.toContain("dc-heat-cell");
		expect(html.match(/<button[^>]*ix-cell/g)).toBeNull();
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

describe("WebhooksListBody while the summary is pending", () => {
	const pending = rowModel(summary(), undefined, [], [], false);

	test("a row with no series says Counting… and never claims a quiet day", () => {
		const html = render({ rows: [pending], summaryLoaded: false });
		expect(html).toContain("Counting…");
		expect(html).not.toContain("Nothing in the last 24h");
	});

	test("a paused row still says Paused", () => {
		const paused = rowModel(
			summary({ status: "paused" }),
			undefined,
			[],
			[],
			false,
		);
		const html = render({ rows: [paused], summaryLoaded: false });
		expect(html).toContain("Paused");
		expect(html).not.toContain("Counting…");
	});

	test("an insight line wins over Counting…", () => {
		const insight = {
			id: "i1",
			rule: "r",
			severity: "losing",
			impact: 1,
			resource: { kind: "webhook", id: summary().id, name: "n" },
			line: "Receiver is rejecting every delivery",
			lead: "",
			body: "",
			evidence: [],
			handoff: { prompt: "", commands: [] },
			how: { detector: "d", facts: [] },
			createdAt: "2026-10-16T00:00:00Z",
		} as Insight;
		const row = rowModel(summary(), undefined, [], [insight], false);
		const html = render({ rows: [row], summaryLoaded: false });
		expect(html).toContain("Receiver is rejecting every delivery");
		expect(html).not.toContain("Counting…");
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

	test("the empty state never mentions keys", () => {
		const html = render({ rows: [] });
		expect(html).not.toContain("Reads need a key");
		expect(html).not.toContain("No active key");
		expect(html).not.toContain("You need a key");
	});
});

describe("WebhooksListBody page insight", () => {
	const stack: Insight = {
		id: "ins_stack_unreachable_webhooks",
		rule: "stack_unreachable_webhooks",
		severity: "losing",
		impact: 3,
		resource: { kind: "account", id: "account", name: "Account" },
		line: "Webhook changes did not reach your stack",
		lead: "Our fault, not yours.",
		body: "We couldn't reach the stack.",
		evidence: [],
		handoff: { prompt: "", commands: [] },
		how: { detector: "stack calls", facts: [] },
		createdAt: "2026-10-15T18:00:00.000Z",
	};

	test("shows the stack insight above the list", () => {
		const html = render({ pageInsights: [stack] });
		expect(html).toContain(stack.line);
		expect(html.indexOf(stack.line)).toBeLessThan(
			html.indexOf("sbtc-deposits"),
		);
	});

	test("shows it even when the list could not load", () => {
		const html = render({
			rows: null,
			notice: { kind: "error", message: "boom" },
			pageInsights: [stack],
		});
		expect(html).toContain(stack.line);
	});
});

describe("WebhooksListBody with the hosted stack asleep", () => {
	test("shows a centered empty state with Wake it over ghost rows, not a boxed notice", () => {
		const html = render({ rows: null, notice: { kind: "asleep" } });
		expect(html).toContain("Your hosted stack is asleep");
		expect(html).toContain(">Wake it<");
		expect(html).toContain("wh-asleep-ghosts");
		expect(html).not.toContain("wh-notice");
	});
});
