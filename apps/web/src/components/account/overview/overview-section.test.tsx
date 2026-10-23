import { describe, expect, test } from "bun:test";
import type { Insight } from "@/lib/insights";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { OnboardingProgress } from "@/lib/onboarding";
import { renderToStaticMarkup } from "react-dom/server";
import { SubgraphRows } from "../subgraphs/list-screen";
import { rowModel } from "../webhooks/rows";
import { FIXTURE_HOURS, summary } from "../webhooks/webhook.fixtures";
import {
	OverviewBody,
	type OverviewFirstWave,
	OverviewSubgraphsSlot,
	SUBGRAPH_HEAD,
	checklistApplies,
	overviewSettled,
} from "./overview-section";
import {
	exampleOverview,
	exampleStack,
	exampleSubgraph,
	exampleWebhooks,
	serverErrorsInsight,
} from "./overview.fixtures";

const delivered = new Array<number>(168).fill(3);
const failed = new Array<number>(168).fill(0);
const series = { delivered, failed };

const healthy = rowModel(summary(), series, FIXTURE_HOURS, []);
const second = rowModel(
	summary({ id: "wh_vault", name: "vault-events" }),
	series,
	FIXTURE_HOURS,
	[],
);
const quiet = rowModel(
	summary({
		id: "wh_waiting",
		name: "sentinel:example-watch",
		lastDeliveryAt: null,
		lastSuccessAt: null,
	}),
	undefined,
	FIXTURE_HOURS,
	[],
);

const base = {
	billing: { creditsUsdMicros: "28230000", spentThisMonthUsdMicros: "6210000" },
	burn: null,
	stack: null,
};

const render = (rows: (typeof healthy)[] | null) =>
	renderToStaticMarkup(<OverviewBody {...base} rows={rows} />);

describe("OverviewBody top note", () => {
	const byRule = (rule: string): Insight => {
		const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
		if (!found) throw new Error(`missing fixture ${rule}`);
		return found;
	};
	const cap = byRule("cap_pace");
	const reads = byRule("duplicate_reads");

	test("shows only the worst open insight, with a line naming the next target", () => {
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} insights={[reads, cap]} />,
		);
		expect(html).toContain(cap.lead);
		expect(html).not.toContain(reads.lead);
		expect(html).toContain("1 more note, on ");
		expect(html.match(/aria-label="Note"/g)).toHaveLength(1);
	});

	test("the note sits above the webhooks, and notes are never nested", () => {
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} insights={[cap]} />,
		);
		expect(html.indexOf(cap.lead)).toBeLessThan(
			html.indexOf('aria-label="Webhooks"'),
		);
		expect(html).not.toContain("ins-card");
	});

	test("a healthy account renders no status card", () => {
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy, second]} insights={[]} />,
		);
		expect(html).not.toContain("ov-note");
		expect(html).not.toContain("ov-notes");
		expect(html).not.toContain("dash-dot alarm");
	});
});

describe("OverviewBody", () => {
	test("draws the Account head and a row per active webhook, with no status sentence", () => {
		const html = render([healthy, second, quiet]);
		expect(html).toContain("<h1>Account</h1>");
		expect(html).toContain(
			"This page shows what&#x27;s running, what it costs",
		);
		expect(html).toContain('href="/account/webhooks/wh_deposits"');
		expect(html).toContain('href="/account/webhooks/wh_vault"');
		expect(html).toContain("Delivered 72 in 24h");
		expect(html).toContain("Last 24h");
		expect(html).not.toContain("Everything is delivering.");
		expect(html).not.toContain("dash-status");
	});

	test("webhooks that never matched fold into one quiet group row", () => {
		const html = render([healthy, quiet]);
		expect(html).toContain("1 more webhook");
		expect(html).toContain("Waiting for a first match");
		expect(html).not.toContain("example-watch");
	});

	test("a failing webhook with no open note gets the you're-on-it card", () => {
		const losing = rowModel(summary(), series, FIXTURE_HOURS, [
			FIXTURE_INSIGHTS[0] as never,
		]);
		const html = render([losing, second]);
		expect(html).toContain("sbtc-deposits is failing. You&#x27;re on it.");
		expect(html).toContain("Receiver returning 502 since 16:06");
		expect(html).toContain("Why");
	});

	test("a second insight on the same webhook adds +1 after the state line", () => {
		const two = rowModel(summary(), series, FIXTURE_HOURS, [
			FIXTURE_INSIGHTS[0] as never,
			FIXTURE_INSIGHTS[1] as never,
		]);
		const html = render([two]);
		expect(html).toContain(">+1<");
		expect(html).not.toContain(">+2<");
	});

	test("no webhooks renders no webhooks section", () => {
		expect(render([])).not.toContain('aria-label="Webhooks"');
	});

	test("before the list loads, it claims nothing about webhooks", () => {
		const html = render(null);
		expect(html).not.toContain('aria-label="Webhooks"');
		expect(html).not.toContain("is failing");
	});

	test("the subgraphs slot renders nothing until its screen fills it", () => {
		expect(renderToStaticMarkup(<OverviewSubgraphsSlot />)).toBe("");
	});

	test("the page runs top note, webhooks, subgraphs, usage, terminal, keys", () => {
		const losing = rowModel(summary(), series, FIXTURE_HOURS, []);
		const html = renderToStaticMarkup(
			<OverviewBody
				{...base}
				rows={[losing]}
				insights={[FIXTURE_INSIGHTS[0] as Insight]}
			/>,
		);
		const order = [
			'aria-label="Note"',
			'aria-label="Webhooks"',
			'aria-label="Subgraphs"',
			'aria-label="Usage and credits"',
			'aria-label="Work from your terminal"',
			'aria-label="Keys and apps"',
		].map((marker) => html.indexOf(marker));
		expect(order.every((n) => n > -1)).toBe(true);
		expect([...order].sort((x, y) => x - y)).toEqual(order);
	});

	test("the old strip and month panel are gone", () => {
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} />,
		);
		expect(html).not.toContain("ov-strip");
		expect(html).not.toContain('aria-label="This month"');
		expect(html).not.toContain("Billing ›");
	});
});

describe("OverviewBody for a new account", () => {
	const flow = <form data-testid="name-step">Name it for where it runs</form>;
	const guide = (
		progress: Partial<OnboardingProgress>,
		keyName: string | null = null,
	) => ({
		progress: {
			key: false,
			read: false,
			push: false,
			complete: false,
			...progress,
		},
		keyName,
		flow,
	});
	const html = (onboarding: ReturnType<typeof guide>) =>
		renderToStaticMarkup(
			<OverviewBody {...base} rows={[]} onboarding={onboarding} />,
		);

	test("no key asks for one, shows the name step and the placeholders", () => {
		const out = html(guide({}));
		expect(out).toContain("Make a key to start.");
		expect(out).toContain(
			"The first 1M rows each month are free, no card needed.",
		);
		expect(out).toContain("Name it for where it runs");
		expect(out).toContain("These fill in as you go.");
		expect(out).toContain("$0.00");
		expect(out).toContain("0 of 1M free rows");
		expect(out).not.toContain("Checking your account.");
	});

	test("a key that has not read yet checks step one and points at step two", () => {
		const out = html(guide({ key: true }, "laptop"));
		expect(out).toContain("Your key works. Read your first rows.");
		expect(out).toContain(
			"laptop is ready. It&#x27;s in Keys whenever you need another.",
		);
		expect(out).toContain("Read your first rows");
		expect(out).not.toContain("These fill in as you go.");
	});

	test("the checklist has two steps: no webhook or subgraph step", () => {
		const out = html(guide({ key: true }));
		expect(out).not.toContain("Get events pushed to you");
		expect(out).not.toContain('href="/account/webhooks"');
	});

	test("a completed checklist gives way to the normal Overview", () => {
		const out = html(
			guide({ key: true, read: true, push: true, complete: true }),
		);
		expect(out).not.toContain("Your key works");
		expect(out).toContain("<h1>Account</h1>");
	});
});

describe("Overview first paint", () => {
	const loaded: OverviewFirstWave = {
		keys: true,
		billing: true,
		service: true,
		stackState: "running",
		webhooks: true,
		asleep: false,
		subgraphs: true,
		rows: true,
		insights: true,
	};

	test("is settled once everything has loaded", () => {
		expect(overviewSettled(loaded)).toBe(true);
	});

	for (const field of [
		"keys",
		"billing",
		"service",
		"rows",
		"insights",
	] as const) {
		test(`waits for ${field}`, () => {
			expect(overviewSettled({ ...loaded, [field]: false })).toBe(false);
			expect(
				overviewSettled({
					...loaded,
					stackState: "none",
					[field]: false,
				}),
			).toBe(false);
		});
	}

	test("does not wait for webhooks or subgraphs when there is no hosted stack", () => {
		expect(
			overviewSettled({
				...loaded,
				stackState: "none",
				webhooks: false,
				subgraphs: false,
			}),
		).toBe(true);
	});

	test("waits for webhooks and subgraphs on a running stack", () => {
		expect(overviewSettled({ ...loaded, webhooks: false })).toBe(false);
		expect(overviewSettled({ ...loaded, subgraphs: false })).toBe(false);
	});

	test("an asleep stack counts as its webhooks being known", () => {
		expect(overviewSettled({ ...loaded, webhooks: false, asleep: true })).toBe(
			true,
		);
	});

	test("the loading skeleton has the Account head and the webhook header", () => {
		const html = renderToStaticMarkup(
			<OverviewBody
				{...base}
				rows={null}
				loading
				insights={FIXTURE_INSIGHTS}
			/>,
		);
		expect(html).toContain("<h1>Account</h1>");
		expect(html).toContain("Deliveries, 24h");
		const block = html.slice(html.indexOf("ov-skel"));
		expect(block.match(/class="dash-row"/g)?.length).toBe(3);
		// Nothing else renders: it would move when the real content lands.
		expect(html).not.toContain("ov-note");
		expect(html).not.toContain('aria-label="Usage and credits"');
	});
});

describe("OverviewBody sections", () => {
	const NOW = new Date("2026-10-15T12:00:00.000Z");
	const render = (over: Partial<Parameters<typeof exampleOverview>[1]> = {}) =>
		renderToStaticMarkup(<OverviewBody {...exampleOverview(NOW, over)} />);
	const credits = (micros: string) => ({
		creditsUsdMicros: micros,
		spentThisMonthUsdMicros: "1910000",
	});

	test("the table lists webhooks under a header that names deliveries", () => {
		const html = render();
		expect(html).toContain("Webhooks</span><span>State</span>");
		expect(html).toContain("Deliveries, 24h");
		expect(html).toContain("Sent, 24h");
		expect(html).toContain("sl webhooks create --help");
		expect(html).not.toContain(">Resource<");
	});

	test("webhook rows draw delivery ticks, not a sparkline", () => {
		const html = render();
		const table = html.slice(
			html.indexOf('aria-label="Webhooks"'),
			html.indexOf('aria-label="Subgraphs"'),
		);
		expect(table).toContain("dc-tick-base");
		expect(table).not.toContain("dc-stroke-a");
	});

	test("a healthy overview shows no status card and no dots on rows", () => {
		const html = render();
		expect(html).not.toContain("ov-note");
		expect(html).not.toContain("name-flag");
		expect(html).not.toContain("dash-dot alarm");
		// The quiet group's hollow dot is the only dot in the webhook table.
		const table = html.slice(
			html.indexOf('class="dash-rows'),
			html.indexOf('aria-label="Subgraphs"'),
		);
		expect(table).not.toContain('class="dash-dot"');
		expect(table).toContain("dash-dot idle");
	});

	test("a failing webhook is the red name box in the table and gets the you're-on-it card", () => {
		const html = render({ rows: exampleWebhooks(NOW, { failing: true }) });
		expect(html).toContain("name-flag");
		expect(html).toContain("dc-fill-alarm");
		expect(html).toContain("sbtc-deposits is failing. You&#x27;re on it.");
	});

	test("a stopped stack with no credits is a top note, and webhook rows go idle", () => {
		const html = render({
			stack: exampleStack("stopped", NOW),
			billing: credits("0"),
		});
		expect(html).toContain("Your hosted stack stopped.");
		expect(html).toContain(
			"Credits ran out, so webhooks aren&#x27;t delivering. Add credits to start it again.",
		);
		expect(html).not.toContain("Got it");
		expect(html).not.toContain("is failing");
		expect(html.match(/Not delivering, stack stopped/g)).toHaveLength(2);
		expect(html).not.toContain("Delivered ");
	});

	test("an asleep account is a top note with no buttons", () => {
		const html = render({
			rows: null,
			asleep: true,
			stack: exampleStack("stopped", NOW),
			billing: credits("28090000"),
		});
		expect(html).toContain("Your hosted stack is asleep.");
		expect(html).toContain("Every webhook is paused, so it isn&#x27;t billed.");
		expect(html).not.toContain("Got it");
		expect(html).not.toContain("dash-dot alarm");
	});

	test("a stopped stack with credits left is not called out of credits", () => {
		const html = render({ stack: exampleStack("stopped", NOW) });
		expect(html).not.toContain("Your hosted stack stopped.");
		expect(html).not.toContain("Not delivering, stack stopped");
	});

	test("an open server-errors insight is the top note", () => {
		const insight = serverErrorsInsight();
		const html = render({ insights: [insight] });
		expect(html).toContain(insight.lead);
		expect(html).toContain("Got it");
		expect(html).toContain("Dismiss");
	});

	test("a recovered server-errors insight is not an open note", () => {
		const html = render({ insights: [serverErrorsInsight(true)] });
		expect(html).not.toContain("ov-note");
	});

	test("rows, credits and the limit show in the usage block", () => {
		const html = render();
		expect(html).toContain("1M free, 260,000 paid");
		expect(html).toContain("$28.09");
		expect(html).toContain("sl credits usage");
	});

	test("keys show in the keys block", () => {
		const html = render();
		expect(html).toContain("Keys and apps");
		expect(html).toContain("prod-indexer");
	});

	test("subgraphs get their own header when there are any", () => {
		const { item, health } = exampleSubgraph(NOW);
		const withSubgraph = render({
			subgraphs: (
				<SubgraphRows
					items={[item]}
					health={{ [item.name]: health }}
					head={SUBGRAPH_HEAD}
				/>
			),
		});
		expect(withSubgraph).toContain("Rows written, 24h");
		expect(withSubgraph.indexOf("Rows written, 24h")).toBeGreaterThan(
			withSubgraph.indexOf("Deliveries, 24h"),
		);
		expect(withSubgraph).toContain("sbtc-flows");
		expect(withSubgraph).toContain("sl subgraphs deploy --help");
		expect(render()).not.toContain("Rows written, 24h");
	});
});

describe("checklistApplies", () => {
	test("an account that never made a key gets the checklist", () => {
		expect(checklistApplies("first", false, false)).toBe(true);
	});

	test("an account with a key that has not read yet gets the checklist", () => {
		expect(checklistApplies("active", false, false)).toBe(true);
	});

	test("the first read, a webhook or subgraph, or Skip ends it for good", () => {
		expect(checklistApplies("active", false, true)).toBe(false);
	});

	test("an account whose keys are all revoked gets the normal Overview", () => {
		expect(checklistApplies("none_active", false, false)).toBe(false);
	});

	test("the first key's flow stays up until its Done", () => {
		expect(checklistApplies("active", true, true)).toBe(true);
	});
});
