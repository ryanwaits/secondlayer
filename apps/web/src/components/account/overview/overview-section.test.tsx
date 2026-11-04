import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	readOpenChoices,
	resolveOpenId,
	writeOpenChoices,
} from "@/lib/insight-open";
import type { Insight } from "@/lib/insights";
import { forAccountRules } from "@/lib/insights-store";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { OnboardingProgress } from "@/lib/onboarding";
import { renderToStaticMarkup } from "react-dom/server";
import { SubgraphRows } from "../subgraphs/list-screen";
import { rowModel } from "../webhooks/rows";
import { FIXTURE_HOURS, summary } from "../webhooks/webhook.fixtures";
import {
	OVERVIEW_ACCOUNT_RULES,
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

describe("OverviewBody account insights", () => {
	const byRule = (rule: string): Insight => {
		const found = FIXTURE_INSIGHTS.find((i) => i.rule === rule);
		if (!found) throw new Error(`missing fixture ${rule}`);
		return found;
	};

	test("the open note's card is the same insight, and read-loop notes stay off Overview", () => {
		const cap = byRule("cap_pace");
		const runway: Insight = {
			...cap,
			id: "ins-credits-runway",
			rule: "credits_runway",
			impact: 3,
			line: "Credits run out in 9 days",
			lead: "Your credits run out before the month does.",
		};
		const reads = byRule("duplicate_reads");
		const shown = forAccountRules([reads, runway, cap], OVERVIEW_ACCOUNT_RULES);
		expect(shown.map((i) => i.id)).toEqual([cap.id, runway.id]);

		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} accountInsights={shown} />,
		);
		// Both notes list; only the top one (cap pace) is open, with its own lead.
		expect(html).toContain(cap.line);
		expect(html).toContain(runway.line);
		expect(html.match(/class="ins-card"/g)).toHaveLength(1);
		expect(html).toContain(cap.lead);
		expect(html).not.toContain(runway.lead);
		// The read-loop insight belongs to Rows.
		expect(html).not.toContain(reads.line);
		expect(html).not.toContain(reads.lead);
		// The open card sits right after the cap-pace note line.
		expect(html.indexOf(cap.lead)).toBeGreaterThan(html.indexOf(cap.line));
		expect(html.indexOf(cap.lead)).toBeLessThan(html.indexOf(runway.line));
	});

	const account = FIXTURE_INSIGHTS.find((i) => i.rule === "duplicate_reads");

	test("account insights render as notes under the rows", () => {
		if (!account) throw new Error("missing fixture");
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} accountInsights={[account]} />,
		);
		expect(html.indexOf(account.line)).toBeGreaterThan(
			html.indexOf("dash-rows"),
		);
	});

	test("no account insights renders no note", () => {
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} accountInsights={[]} />,
		);
		expect(html).not.toContain("ins-note");
	});
});

describe("OverviewBody", () => {
	test("says everything is delivering and draws a row per active webhook", () => {
		const html = render([healthy, second, quiet]);
		expect(html).toContain("Everything is delivering.");
		expect(html).toContain('href="/account/webhooks/wh_deposits"');
		expect(html).toContain('href="/account/webhooks/wh_vault"');
		expect(html).toContain("Delivered 72 in 24h");
		expect(html).toContain("3 webhooks");
		expect(html).toContain("$28.23 in credits");
	});

	test("webhooks that never matched fold into one quiet group row", () => {
		const html = render([healthy, quiet]);
		expect(html).toContain("1 more webhook");
		expect(html).toContain("Waiting for a first match");
		expect(html).not.toContain("example-watch");
	});

	test("a losing insight turns the sentence into a count of what is failing", () => {
		const losing = rowModel(summary(), series, FIXTURE_HOURS, [
			FIXTURE_INSIGHTS[0] as never,
		]);
		const html = render([losing, second]);
		expect(html).toContain("1 webhook is failing.");
		expect(html).toContain("Receiver returning 502 since 16:06");
	});

	test("no webhooks yet is its own sentence, not an error", () => {
		expect(render([])).toContain("No webhooks yet.");
	});

	test("before the list loads, it does not claim anything is delivering", () => {
		const html = render(null);
		expect(html).toContain("Checking your account.");
		expect(html).not.toContain("Everything is delivering.");
	});

	test("the subgraphs slot renders nothing until its screen fills it", () => {
		expect(renderToStaticMarkup(<OverviewSubgraphsSlot />)).toBe("");
	});

	test("the month panel keeps the spend line and leaves the meter to the Rows cell", () => {
		const html = renderToStaticMarkup(
			<OverviewBody {...base} rows={[healthy]} />,
		);
		expect(html).toContain("$6.21");
		expect(html).toContain("$28.23 left");
		const month = html.slice(html.indexOf('aria-label="This month"'));
		expect(month).not.toContain("dc-meter");
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
		expect(out).toContain("No webhooks yet.");
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

	test("the loading skeleton has the webhook header and a strip", () => {
		const html = renderToStaticMarkup(
			<OverviewBody
				{...base}
				rows={null}
				loading
				accountInsights={FIXTURE_INSIGHTS}
			/>,
		);
		expect(html).toContain("Checking your account.");
		expect(html).toContain("Deliveries, 24h");
		const block = html.slice(html.indexOf("ov-skel"));
		expect(block.match(/class="dash-row"/g)?.length).toBe(3);
		expect(block.match(/class="ov-cell"/g)?.length).toBe(3);
		// Nothing else renders: it would move when the real content lands.
		expect(html).not.toContain('aria-label="This month"');
		expect(html).not.toContain("ins-");
	});
});

describe("OverviewBody table and strip", () => {
	const NOW = new Date("2026-10-15T12:00:00.000Z");
	const render = (over: Partial<Parameters<typeof exampleOverview>[1]> = {}) =>
		renderToStaticMarkup(<OverviewBody {...exampleOverview(NOW, over)} />);
	/** The table, the strip and the markup after the strip. */
	const parts = (html: string) => {
		const table = html.indexOf('class="dash-rows');
		const strip = html.indexOf('class="ov-strip"');
		const end = html.indexOf("</section>", strip);
		return {
			sentence: html.slice(0, table),
			table: html.slice(table, strip),
			strip: html.slice(strip, end),
			after: html.slice(end),
		};
	};
	const credits = (micros: string) => ({
		creditsUsdMicros: micros,
		spentThisMonthUsdMicros: "1910000",
	});

	test("the table lists webhooks under a header that names deliveries", () => {
		const html = render();
		expect(html).toContain("Webhooks</span><span>State</span>");
		expect(html).toContain("Deliveries, 24h");
		expect(html).toContain("Sent, 24h");
		expect(html).not.toContain("Last 24h");
		expect(html).not.toContain(">Resource<");
	});

	test("webhook rows draw delivery ticks, not a sparkline", () => {
		const { table } = parts(render());
		expect(table).toContain("dc-tick-base");
		expect(table).not.toContain("dc-stroke-a");
	});

	test("rows, keys and the hosted stack sit in a strip under the table, before the month", () => {
		const html = render();
		const table = html.indexOf("dash-rows");
		const strip = html.indexOf('class="ov-strip"');
		const month = html.indexOf('aria-label="This month"');
		expect(table).toBeGreaterThan(-1);
		expect(strip).toBeGreaterThan(table);
		expect(month).toBeGreaterThan(strip);
		const { strip: cells } = parts(html);
		expect(cells).toContain("Rows · October");
		expect(cells).toContain('href="/account/keys"');
		expect(cells).toContain("Hosted stack");
		expect(cells).toContain("$0.33");
		expect(cells).toContain("Free 1M used up · 260,000 paid");
		expect(cells).toContain("read on 1 of the last 24 days");
		expect(cells).toContain("dc-meter-over");
	});

	test("a healthy overview shows no status marks on the sentence, rows or cells", () => {
		const { sentence, table, strip } = parts(render());
		expect(sentence).not.toContain("-dot");
		expect(table).not.toContain("-dot");
		expect(table).not.toContain("dash-row att");
		expect(table).not.toContain("dash-row fail");
		expect(strip).not.toContain("-dot");
		expect(strip).not.toContain("ins-dot");
	});

	test("a failing webhook tints its row red and the sentence names it", () => {
		const html = renderToStaticMarkup(
			<OverviewBody
				{...exampleOverview(NOW, {
					rows: exampleWebhooks(NOW, { failing: true }),
				})}
			/>,
		);
		const { sentence, table, strip } = parts(html);
		expect(sentence).toContain("1 webhook is failing.");
		expect(table).toContain("dash-row fail");
		expect(table).toContain("dc-fill-alarm");
		expect(strip).not.toContain("-dot");
	});

	test("a stopped stack reads stopped in the strip and tints no row", () => {
		const { table, strip } = parts(
			render({
				stack: exampleStack("stopped", NOW),
				billing: credits("0"),
			}),
		);
		expect(strip).not.toContain("-dot");
		expect(strip).toContain("stopped");
		expect(strip).toContain("Add credits to start it again.");
		expect(strip).toContain("dc-stroke-alarm");
		expect(table).not.toContain("dash-row fail");
	});

	test("a stopped stack names itself in the sentence and leaves webhook rows neutral", () => {
		const html = render({
			stack: exampleStack("stopped", NOW),
			billing: credits("0"),
		});
		const { sentence, table } = parts(html);
		expect(sentence).toContain("Your hosted stack stopped.");
		expect(sentence).toContain(
			"Credits ran out, so webhooks aren&#x27;t delivering.",
		);
		expect(table.match(/Not delivering, stack stopped/g)).toHaveLength(2);
		expect(table).not.toContain("Delivered ");
	});

	test("an asleep account shows no alarm in the strip", () => {
		const html = render({
			rows: null,
			asleep: true,
			stack: exampleStack("stopped", NOW),
			billing: credits("28090000"),
		});
		const { sentence, strip } = parts(html);
		expect(sentence).toContain("Your hosted stack is asleep.");
		expect(strip).toContain("asleep");
		expect(strip).toContain(
			"Every webhook is paused, so it isn&#x27;t billed.",
		);
		expect(strip).not.toContain("-dot");
		expect(strip).not.toContain("dc-stroke-alarm");
	});

	test("a stopped stack with credits left is not called out of credits", () => {
		const html = render({ stack: exampleStack("stopped", NOW) });
		expect(html).not.toContain("Your hosted stack stopped.");
		expect(html).not.toContain("Not delivering, stack stopped");
	});

	test("an active server-errors insight shows in the rows cell and its card is open", () => {
		const insight = serverErrorsInsight();
		const html = render({ accountInsights: [insight] });
		const { strip, after } = parts(html);
		expect(strip).toContain("ov-flag");
		expect(strip).toContain("3 requests failed on our side");
		expect(strip).toContain("ins-dot alarm");
		expect(strip).toContain("Hide ›");
		expect(strip).toContain(`aria-controls="ins-panel-${insight.id}"`);
		expect(after).toContain(
			`class="ov-strip-card" id="ins-panel-${insight.id}"`,
		);
		expect(after).toContain(insight.lead);
		// It is not also listed as a note above the month.
		expect(html).not.toContain("ins-note");
	});

	test("a recovered server-errors insight is one collapsed line", () => {
		const html = render({ accountInsights: [serverErrorsInsight(true)] });
		const { strip } = parts(html);
		expect(strip).toContain("Why ›");
		expect(strip).toContain("ins-dot idle");
		expect(strip).toContain("recovered");
		expect(html).not.toContain("ov-strip-card");
	});

	test("money insights stay above the month panel, not in a cell", () => {
		const cap = FIXTURE_INSIGHTS.find((i) => i.rule === "cap_pace");
		if (!cap) throw new Error("missing fixture");
		const html = render({ accountInsights: [cap] });
		const { strip } = parts(html);
		expect(strip).not.toContain("ov-flag");
		expect(html.indexOf(cap.line)).toBeGreaterThan(html.indexOf("</section>"));
		expect(html.indexOf(cap.line)).toBeLessThan(
			html.indexOf('aria-label="This month"'),
		);
	});

	test("a stale key adds a flag in the keys cell with a yellow dot", () => {
		const [key] = exampleOverview(NOW).keys ?? [];
		if (!key) throw new Error("missing fixture");
		const { strip } = parts(
			render({
				keys: [
					key,
					{
						...key,
						id: "k_old",
						name: "old-indexer",
						lastUsedAt: new Date(NOW.getTime() - 40 * 86_400_000).toISOString(),
					},
				],
			}),
		);
		expect(strip).toContain("old-indexer unused 40 days");
		expect(strip).toContain("ins-dot hi");
	});

	test("no keys of your own says so and points at the command", () => {
		const { strip } = parts(render({ keys: [] }));
		expect(strip).toContain("None");
		expect(strip).toContain("sl keys create");
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
		const { table } = parts(withSubgraph);
		expect(table).toContain("Rows written, 24h");
		expect(table.indexOf("Rows written, 24h")).toBeGreaterThan(
			table.indexOf("Deliveries, 24h"),
		);
		expect(table).toContain("sbtc-flows");
		expect(parts(render()).table).not.toContain("Rows written, 24h");
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

describe("Overview findings list", () => {
	const losing = FIXTURE_INSIGHTS.find(
		(i) => i.severity === "losing",
	) as Insight;
	const willFail = FIXTURE_INSIGHTS.find(
		(i) => i.severity === "will_fail",
	) as Insight;
	const subgraphInsight = (over: Partial<Insight> = {}): Insight => ({
		...willFail,
		id: "ins-sg",
		resource: { kind: "subgraph", id: "sbtc-flows", name: "sbtc-flows" },
		line: "sbtc-flows handler errors rising",
		...over,
	});
	const failing = rowModel(summary(), series, FIXTURE_HOURS, [losing]);
	const attention = rowModel(
		summary({ id: "wh_vault", name: "vault-events" }),
		series,
		FIXTURE_HOURS,
		[{ ...willFail, id: "ins-att" }],
	);
	const html = (rows: (typeof healthy)[], subgraphFindings: Insight[] = []) =>
		renderToStaticMarkup(
			<OverviewBody
				{...base}
				rows={rows}
				subgraphFindings={subgraphFindings}
			/>,
		);
	const table = (out: string) => out.slice(out.indexOf('class="dash-rows'));

	test("lists one line per flagged resource, failing first, above the tables", () => {
		const out = html([attention, failing], [subgraphInsight()]);
		expect(out).toContain('aria-label="Needs a look"');
		expect(out).toContain("Needs a look · 3");
		const at = (text: string) => out.indexOf(text);
		expect(at(losing.line)).toBeGreaterThan(-1);
		expect(at(losing.line)).toBeLessThan(at(willFail.line));
		expect(at(willFail.line)).toBeLessThan(at("sbtc-flows handler errors"));
		expect(at("sbtc-flows handler errors")).toBeLessThan(
			out.indexOf('class="dash-rows'),
		);
	});

	test("renders no section when nothing is flagged, and ignores recovered insights", () => {
		expect(html([healthy, second])).not.toContain("Needs a look");
		const recovered = rowModel(summary(), series, FIXTURE_HOURS, [
			{ ...losing, severity: "recovered" },
		]);
		expect(html([recovered])).not.toContain("Needs a look");
	});

	test("rows stay plain links with no Why toggle", () => {
		const out = html([failing, attention]);
		expect(table(out)).not.toContain("Why");
		expect(table(out)).not.toContain("ins-card");
		expect(table(out)).toContain('href="/account/webhooks/wh_deposits"');
	});

	test("subgraph rows carry no Why toggle either", () => {
		const sg = exampleSubgraph(new Date("2026-10-15T12:00:00.000Z"));
		const out = renderToStaticMarkup(
			<SubgraphRows
				items={[sg.item]}
				health={{ [sg.item.name]: sg.health }}
				insights={[subgraphInsight()]}
			/>,
		);
		expect(out).toContain("sbtc-flows handler errors rising");
		expect(out).not.toContain("Why");
		expect(out).not.toContain("ins-card");
	});

	test("the first finding is open on load and the rest are closed", () => {
		const out = html([failing, attention]);
		expect(out.match(/class="ins-card"/g)).toHaveLength(1);
		expect(out.indexOf(losing.lead)).toBeGreaterThan(-1);
		expect(out).not.toContain(willFail.lead);
	});

	describe("headline", () => {
		const wh = (n: number, insight: Insight) =>
			Array.from({ length: n }, (_, i) =>
				rowModel(
					summary({ id: `wh_${i}`, name: `w${i}` }),
					series,
					FIXTURE_HOURS,
					[{ ...insight, id: `${insight.id}-${i}` }],
				),
			);
		const head = (rows: (typeof healthy)[], sg: Insight[] = []) => {
			const out = html(rows, sg);
			return out.slice(0, out.indexOf('class="dash-rows'));
		};
		test("same kind and severity keeps the specific form", () => {
			expect(head(wh(1, losing))).toContain("1 webhook is failing.");
			expect(head(wh(2, losing))).toContain("2 webhooks are failing.");
			expect(head(wh(2, willFail))).toContain("2 webhooks need a look.");
			expect(head([healthy], [subgraphInsight()])).toContain(
				"1 subgraph needs a look.",
			);
		});
		test("mixed kinds or severities say things", () => {
			expect(head([...wh(1, willFail)], [subgraphInsight()])).toContain(
				"2 things need a look.",
			);
			expect(head([...wh(1, losing), ...wh(1, willFail)])).toContain(
				"2 things need a look.",
			);
		});
	});
});

describe("remembered open choice", () => {
	const ids = ["a", "b", "c"];
	const stubStorage = (storage: unknown) => {
		(globalThis as { window?: unknown }).window = { localStorage: storage };
	};
	afterEach(() => {
		(globalThis as { window?: unknown }).window = undefined;
	});

	test("opens the first by default", () => {
		expect(resolveOpenId(ids, {})).toBe("a");
	});
	test("a saved hide keeps the first closed", () => {
		expect(resolveOpenId(ids, { a: false })).toBeNull();
	});
	test("a saved show on the second opens it instead", () => {
		expect(resolveOpenId(ids, { b: true })).toBe("b");
	});
	test("falls back to the default when storage throws", () => {
		const boom = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
		};
		stubStorage(boom);
		expect(readOpenChoices()).toEqual({});
		expect(() => writeOpenChoices({ a: true }, ids)).not.toThrow();
	});
	test("writes booleans only and prunes ids that are gone", () => {
		const data: Record<string, string> = {};
		stubStorage({
			getItem: (k: string) => data[k] ?? null,
			setItem: (k: string, v: string) => {
				data[k] = v;
			},
		});
		writeOpenChoices({ a: true, gone: false }, ids);
		expect(readOpenChoices()).toEqual({ a: true });
	});
});

describe("insight spacing css", () => {
	const css = readFileSync(
		join(import.meta.dir, "../../../app/globals.css"),
		"utf8",
	);
	test("the opened card sits 18px under its line", () => {
		expect(css).toMatch(
			/\.ins-note > div > \.ins-card \{\s*margin: 18px 0 16px;/,
		);
	});
	test("the detail page insight has 40px above and 44px below", () => {
		expect(css).toMatch(/\.wd-head \+ \.ins-stack \{\s*margin: 40px 0 44px;/);
	});
});
