import { describe, expect, mock, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import { renderToStaticMarkup } from "react-dom/server";
import { checkedRadios } from "../../../lib/test-render";

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

const { BillingBody } = await import("./billing-screen");
const { AmountChoice, otherCellOn } = await import("./amount-choice");
const { MonthlyLimitRow, limitDigits } = await import("./limits-and-emails");
const { RunwayLine } = await import("../credits-panel");

const NOW = new Date("2026-10-10T12:00:00.000Z");

const base = {
	now: NOW,
	billing: { creditsUsdMicros: "12500000", spentThisMonthUsdMicros: "4200000" },
	burn: { rateDayUsdMicros: "250000", windowHours: 24 },
	service: { state: "running" as const, lastChargedAt: null, memory24h: [] },
	usage: [
		{ unit: "rows.delivered", quantity: "900000", usdMicros: "0" },
		{ unit: "memory.gb_hour", quantity: "120", usdMicros: "3360000" },
		{ unit: "sentinel.run", quantity: "17", usdMicros: "25500000" },
		{ unit: "grant", quantity: "5", usdMicros: "-5000000" },
	],
	daily: [
		{ date: "2026-10-02", unit: "memory.gb_hour", usdMicros: "1000000" },
		{ date: "2026-10-02", unit: "sentinel.run", usdMicros: "9000000" },
	],
	capUsd: null,
	onCapChange: () => {},
	addCredits: <p>credits-slot</p>,
	settings: <p>settings-slot</p>,
	credits: [
		{
			occurredAt: "2026-10-09T10:00:00.000Z",
			kind: "grant" as const,
			source: "welcome",
			usdMicros: "5000000",
		},
		{
			occurredAt: "2026-10-02T10:00:00.000Z",
			kind: "topup" as const,
			source: "stripe",
			usdMicros: "25000000",
		},
	],
};

describe("BillingBody insights", () => {
	test("an insight sits under the status sentence as a note", () => {
		const runway = FIXTURE_INSIGHTS.find((i) => i.rule === "duplicate_reads");
		if (!runway) throw new Error("missing fixture");
		const html = renderToStaticMarkup(
			<BillingBody {...base} insights={[runway]} />,
		);
		expect(html).toContain(runway.line);
		expect(html).not.toContain("worst first");
	});

	test("with no insights nothing renders in the slot", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} insights={[]} />);
		expect(html).not.toContain("ins-note");
		expect(html).not.toContain("ins-stack");
	});
});

describe("BillingBody", () => {
	test("opens with the balance and how long it lasts at this pace", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toContain("$12.50 left");
		expect(html).toContain("about 50 days at this pace");
		expect(html).not.toContain('href="#packs"');
	});

	test("adding credits sits in its own section, the anchor the low-balance banner scrolls to", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toMatch(/aria-label="Add credits" id="packs"/);
		expect(html).toContain("credits-slot");
		expect(html.indexOf("Usage this month")).toBeLessThan(
			html.indexOf('id="packs"'),
		);
	});

	test("limits and emails sit beside how you're billed", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toContain("settings-slot");
		expect(html).toContain("How you&#x27;re billed");
	});

	test("says the hosted stack stopped when it has", () => {
		const html = renderToStaticMarkup(
			<BillingBody
				{...base}
				billing={{ creditsUsdMicros: "0", spentThisMonthUsdMicros: "4200000" }}
				service={{ state: "stopped", lastChargedAt: null, memory24h: [] }}
			/>,
		);
		expect(html).toContain("your hosted stack has stopped");
	});

	test("says it is paused once spend reaches the cap", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} capUsd={4} />);
		expect(html).toContain("Paused: you reached your $4 cap.");
	});

	test("the by-unit table gives Sentinel runs a line of its own, after the hosted units", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toContain("Sentinel runs");
		expect(html).toContain("$1.50/run");
		expect(html.indexOf("Hosted stack memory")).toBeLessThan(
			html.indexOf("Sentinel runs</td>"),
		);
		// A grant is credit, not a charge.
		expect(html).not.toContain("-$5.00");
	});

	test("the spend line notes that Sentinel usage is not in it", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toContain("Sentinel usage ($25.50) is billed per check");
	});

	test("the credits table shows a 5,000,000 micro grant as +$5.00, newest first", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toContain("+$5.00");
		expect(html).toContain("+$25.00");
		expect(html.indexOf("10-09")).toBeLessThan(html.indexOf("10-02"));
		expect(html).toContain("Top-up");
	});
});

describe("AmountChoice", () => {
	const render = (value: number) =>
		renderToStaticMarkup(<AmountChoice value={value} onChange={() => {}} />);

	test("offers the four packs and an Other box, with no None", () => {
		const html = render(25);
		for (const label of ["$10", "$25", "$50", "$100"]) {
			expect(html).toContain(`<span>${label}</span>`);
		}
		expect(html).toContain('placeholder="Other"');
		expect(html).not.toContain("None");
	});

	test("a pack value checks that pack", () => {
		expect(Object.values(checkedRadios(render(25)))).toEqual(["25"]);
	});

	test("a custom amount fills the Other box and leaves every radio unchecked", () => {
		const html = render(150);
		expect(html).toContain('class="choice-other on"');
		expect(html).toContain('value="150"');
		expect(checkedRadios(html)).toEqual({});
	});
});

describe("otherCellOn", () => {
	test("tints only once the typed amount is valid", () => {
		expect(otherCellOn("3", 25)).toBe(false);
		expect(otherCellOn("", 150)).toBe(false);
		expect(otherCellOn("150", 25)).toBe(true);
	});

	test("untouched, it tints for an amount that is not a pack", () => {
		expect(otherCellOn(null, 150)).toBe(true);
		expect(otherCellOn(null, 25)).toBe(false);
	});
});

describe("MonthlyLimitRow", () => {
	test("typed letters never reach the commit, so only an empty box clears the limit", () => {
		expect(limitDigits("100a")).toBe("100");
		expect(limitDigits("abc")).toBe("");
	});

	const render = (capUsd: number | null) =>
		renderToStaticMarkup(
			<MonthlyLimitRow capUsd={capUsd} onCapChange={() => {}} spentUsd={4.2} />,
		);

	test("with no limit the field is empty and the balance is the ceiling", () => {
		const html = render(null);
		expect(html).toContain('placeholder="No limit"');
		expect(html).toContain("None set. Your balance is the only ceiling.");
	});

	test("with a limit the field holds it and the line says what pauses", () => {
		const html = render(100);
		expect(html).toContain('value="100"');
		expect(html).toContain("Everything pauses past $100 in a month");
		expect(html).toContain("$4.20 so far this month");
	});
});

describe("RunwayLine", () => {
	const line = (over: Partial<Parameters<typeof RunwayLine>[0]> = {}) =>
		renderToStaticMarkup(
			<RunwayLine
				amount={25}
				valid
				balanceUsdMicros={28_060_000}
				rateDayUsdMicros={146_100}
				stopped={false}
				now={NOW}
				{...over}
			/>,
		);

	test("a burning balance names the month it lasts until", () => {
		const html = line();
		expect(html).toContain("Balance goes to $53.06, which lasts until about");
		expect(html).toContain("<b>Oct 2027</b>");
	});

	test("no burn just says where the balance goes", () => {
		expect(line({ rateDayUsdMicros: 0 })).toContain("Balance goes to $53.06.");
	});

	test("an invalid Other amount states the range", () => {
		expect(line({ valid: false })).toContain(
			"Pick a whole-dollar amount from $5 to $1,000.",
		);
	});

	test("a stopped stack says it starts again", () => {
		expect(line({ stopped: true })).toContain("starts again");
	});
});

describe("BillingBody for a new account", () => {
	const fresh = {
		...base,
		billing: { creditsUsdMicros: "0", spentThisMonthUsdMicros: "0" },
		burn: null,
		service: null,
		usage: [],
		daily: [],
	};

	test("$0 spent and no credits explains the free 1M and when to add credits", () => {
		const html = renderToStaticMarkup(<BillingBody {...fresh} />);
		expect(html).toContain("$0.00 spent this month.");
		expect(html).toContain("Add credits only when you pass them.");
		expect(html).toContain("Block headers never count.");
		expect(html).not.toContain("Only needed past the free 1M.");
		expect(html).not.toContain('href="#packs"');
	});

	test("the Add credits section sits beside Free rows, and both layouts list the rates", () => {
		const html = renderToStaticMarkup(<BillingBody {...fresh} />);
		expect(html).toMatch(/aria-label="Add credits" id="packs"/);
		expect(html.indexOf('aria-label="Free rows"')).toBeLessThan(
			html.indexOf('id="packs"'),
		);
		expect(html).toContain("How you&#x27;re billed");
		expect(html).toContain("settings-slot");
	});

	test("an account with credits keeps the normal screen", () => {
		const html = renderToStaticMarkup(
			<BillingBody {...fresh} billing={base.billing} />,
		);
		expect(html).not.toContain("$0.00 spent this month.");
		expect(html).toContain("left");
	});
});

describe("BillingBody charts", () => {
	test("both charts hold their final height before the daily data lands", () => {
		const html = renderToStaticMarkup(
			<BillingBody {...base} daily={undefined} />,
		);
		expect(html.match(/dc-chart-box/g)?.length).toBe(2);
		expect(html.match(/height:150px/g)?.length).toBeGreaterThanOrEqual(2);
	});
});
