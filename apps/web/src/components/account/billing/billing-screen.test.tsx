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
const { SpendCapControl } = await import("./spend-cap-control");

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
		expect(html).toContain('href="#packs"');
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

	test("the spend line notes that Sentinel runs are not in it", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toContain("Sentinel runs ($25.50) are billed per run");
	});

	test("the credits table shows a 5,000,000 micro grant as +$5.00, newest first", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toContain("+$5.00");
		expect(html).toContain("+$25.00");
		expect(html.indexOf("10-09")).toBeLessThan(html.indexOf("10-02"));
		expect(html).toContain("Top-up");
	});

	test("with no cap it describes none and shows the free rows meter", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} />);
		expect(html).toContain("No cap set.");
		expect(html).toContain("Free rows · 900,000 of 1M used");
		expect(html).toContain("resets Nov 1");
	});

	test("with a cap it says so and meters spend against it", () => {
		const html = renderToStaticMarkup(<BillingBody {...base} capUsd={40} />);
		expect(html).toContain("Capped at $40 a month.");
		expect(html).toContain("$4.20 of $40 this month");
	});
});

describe("SpendCapControl", () => {
	const render = (capUsd: number | null) =>
		renderToStaticMarkup(
			<SpendCapControl capUsd={capUsd} onChange={() => {}} />,
		);

	test("offers four presets, an Other box and None, with None chosen when there is no cap", () => {
		const html = render(null);
		for (const label of ["$10", "$25", "$50", "$100", "None"]) {
			expect(html).toContain(`<span>${label}</span>`);
		}
		expect(html).toContain('placeholder="Other"');
		expect(Object.values(checkedRadios(html))).toEqual(["none"]);
	});

	test("a $25 cap chooses the $25 segment", () => {
		expect(Object.values(checkedRadios(render(25)))).toEqual(["25"]);
	});

	test("a custom cap fills the Other box and chooses it, leaving every radio unchecked", () => {
		const html = render(40);
		expect(html).toContain('class="bl-cap-in on"');
		expect(html).toContain('value="40"');
		expect(checkedRadios(html)).toEqual({});
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
		expect(html).toContain("Only needed past the free 1M.");
		expect(html).toContain("acct-btn line small");
		expect(html).not.toContain("acct-btn solid small");
	});

	test("an account with credits keeps the normal screen", () => {
		const html = renderToStaticMarkup(
			<BillingBody {...fresh} billing={base.billing} />,
		);
		expect(html).not.toContain("$0.00 spent this month.");
		expect(html).toContain("left");
	});
});
