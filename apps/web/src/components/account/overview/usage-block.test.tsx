import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { exampleRows } from "./overview.fixtures";
import { UsageBlock, limitLine } from "./usage-block";

const now = new Date("2026-10-15T12:00:00.000Z");
const noCaps = {
	monthlyCapCents: null,
	alertThresholdPct: 80,
	frozenAt: null,
	alertSentAt: null,
};

const render = (over: Partial<Parameters<typeof UsageBlock>[0]> = {}) =>
	renderToStaticMarkup(
		<UsageBlock
			readUsage={null}
			billing={{ creditsUsdMicros: "0", spentThisMonthUsdMicros: "0" }}
			burn={null}
			caps={noCaps}
			now={now}
			{...over}
		/>,
	);

describe("UsageBlock", () => {
	test("a fresh account shows nothing used, nothing spent and no limit", () => {
		const html = render();
		expect(html).toContain("0 of 1M free");
		expect(html).toContain("$0.00");
		expect(html).toContain("No monthly limit set.");
		expect(html).toContain("Resets Nov 1. Block headers never count.");
		expect(html).toContain("Set a limit");
		expect(html).toContain("Add credits");
		expect(html).toContain("sl credits usage");
		expect(html).toContain(
			"Add credits opens Stripe. One-time payment, nothing auto-renews.",
		);
	});

	test("a normal month shows the meter, the balance and the runway", () => {
		const html = render({
			readUsage: {
				...exampleRows(now),
				allowance: { ...exampleRows(now).allowance, usedThisMonth: 400_000 },
			},
			billing: {
				creditsUsdMicros: "28090000",
				spentThisMonthUsdMicros: "1910000",
			},
			burn: { rateDayUsdMicros: "2000000", windowHours: 24 },
		});
		expect(html).toContain("400,000 of 1M free");
		expect(html).toContain("$28.09");
		expect(html).toContain("about 14 days");
	});

	test("rows past the free 1M show the paid part", () => {
		const html = render({ readUsage: exampleRows(now) });
		expect(html).toContain("1M free, 260,000 paid");
	});

	test("a limit names itself and the button reads Change limit", () => {
		const html = render({
			caps: { ...noCaps, monthlyCapCents: 5000 },
			billing: {
				creditsUsdMicros: "1000000",
				spentThisMonthUsdMicros: "1910000",
			},
		});
		expect(html).toContain("Limit $50 a month, $1.91 used.");
		expect(html).toContain("Change limit");
		expect(html).not.toContain("Set a limit");
	});
});

describe("limitLine", () => {
	test("says so when there is no limit", () => {
		expect(limitLine(null, 3)).toBe("No monthly limit set.");
	});
});
