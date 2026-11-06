import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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

const { otherCellOn } = await import("./amount-choice");
const { limitDigits } = await import("./limits-and-emails");
const { RunwayLine } = await import("../credits-panel");

const NOW = new Date("2026-10-10T12:00:00.000Z");

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
		expect(html).toContain("Balance goes to <b");
		expect(html).toContain("$53.06</b>, about <b>Oct 2027</b> at this pace.");
		expect(html).not.toContain("One-time payment.");
	});
});
