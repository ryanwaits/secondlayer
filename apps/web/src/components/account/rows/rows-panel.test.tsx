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

const { OverviewRowsRow, RowsBody } = await import("./rows-panel");
type RowsResponse = import("@/lib/rows").RowsResponse;

const NOW = new Date("2026-10-15T12:00:00.000Z");

const histogram: RowsResponse["histogram"] = [
	{ bucket: "1-9", calls: 40, rows: 120 },
	{ bucket: "10-99", calls: 20, rows: 900 },
	{ bucket: "100-499", calls: 10, rows: 2000 },
	{ bucket: "500-999", calls: 2, rows: 1500 },
	{ bucket: "1000+", calls: 5, rows: 5000 },
];

const exhausted: RowsResponse = {
	allowance: {
		monthly: 1_000_000,
		usedThisMonth: 1_200_000,
		exhaustedOn: "2026-10-06",
		paidRowsThisMonth: 200_000,
		paidUsdMicrosThisMonth: "1000000",
		resetsOn: "2026-11-01",
	},
	daily: [
		{
			date: "2026-10-06",
			source: "index",
			rows: 900_000,
			freeRows: 800_000,
			paidRows: 100_000,
			calls: 900,
			paidUsdMicros: "500000",
		},
	],
	hourlyToday: [],
	bySource: [
		{ source: "index", rows: 1_100_000, calls: 1100 },
		{ source: "streams", rows: 100_000, calls: 30 },
	],
	histogram,
	errors: [
		{
			status: 404,
			code: "NOT_FOUND",
			path: "/v1/runes/etchings/x",
			count: 7,
			last: "",
		},
		{ status: 400, code: "BAD", path: "/v1/index/events", count: 3, last: "" },
	],
};

const under: RowsResponse = {
	...exhausted,
	allowance: {
		...exhausted.allowance,
		usedThisMonth: 250_000,
		exhaustedOn: null,
		paidRowsThisMonth: 0,
		paidUsdMicrosThisMonth: "0",
	},
	errors: [],
};

const base = { now: NOW, onRetry: () => {} };

describe("RowsBody", () => {
	test("renders nothing until the data has been asked for", () => {
		const html = renderToStaticMarkup(
			<RowsBody {...base} status="not_loaded" data={null} />,
		);
		expect(html).toBe("");
	});

	test("a failed load says so and offers Retry", () => {
		const html = renderToStaticMarkup(
			<RowsBody {...base} status="failed" data={null} />,
		);
		expect(html).toContain("Retry");
		expect(html).toContain("Couldn&#x27;t load your rows.");
	});

	test("an exhausted allowance names the day and the paid rows", () => {
		const html = renderToStaticMarkup(
			<RowsBody {...base} status="ok" data={exhausted} />,
		);
		expect(html).toContain("1.2M rows this month.");
		expect(html).toContain("ran out on Oct 6");
		expect(html).toContain("200,000 paid rows since, $1.00");
		expect(html).toContain("Index");
		expect(html).toContain("Streams");
		expect(html).toContain("1,100,000 rows");
		expect(html).toContain("Your errors");
	});

	test("lists 4xx errors with a summary and no server-side line when there are no 5xx", () => {
		const html = renderToStaticMarkup(
			<RowsBody {...base} status="ok" data={exhausted} />,
		);
		expect(html).toContain("3× 400 · 7× 404");
		expect(html).not.toContain("failed on our side");
	});

	test("5xx errors get their own line and are not counted as yours", () => {
		const html = renderToStaticMarkup(
			<RowsBody
				{...base}
				status="ok"
				data={{
					...exhausted,
					errors: [
						...exhausted.errors,
						{
							status: 500,
							code: "INTERNAL",
							path: "/v1/index/events",
							count: 2,
							last: "",
						},
					],
				}}
			/>,
		);
		expect(html).toContain("2 reads failed on our side");
		expect(html).toContain("You weren&#x27;t billed for these.");
		expect(html).toContain("3× 400 · 7× 404");
	});

	test("under the allowance shows how much of the free 1M is used", () => {
		const html = renderToStaticMarkup(
			<RowsBody {...base} status="ok" data={under} />,
		);
		expect(html).toContain("of your free 1M used");
		expect(html).toContain("Resets Nov 1");
		expect(html).not.toContain("ran out on");
		expect(html).toContain("No errors from you in the last 24 hours.");
	});

	test("with no insights the insight header markup is absent", () => {
		const html = renderToStaticMarkup(
			<RowsBody {...base} status="ok" data={exhausted} insights={[]} />,
		);
		expect(html).not.toContain("ins-stack");
		expect(html).not.toContain("ins-note");
	});
});

describe("OverviewRowsRow", () => {
	test("links to the Rows screen with this month, today's rows and a sparkline", () => {
		const html = renderToStaticMarkup(
			<OverviewRowsRow
				now={NOW}
				data={{
					...exhausted,
					hourlyToday: [
						{
							hour: "2026-10-15T01:00:00.000Z",
							source: "index",
							rows: 40,
							calls: 2,
						},
						{
							hour: "2026-10-15T09:00:00.000Z",
							source: "index",
							rows: 60,
							calls: 3,
						},
					],
				}}
			/>,
		);
		expect(html).toContain('href="/account/rows"');
		expect(html).toContain("1.2M this month");
		expect(html).toContain("free 1M used up");
		expect(html).toContain("<svg");
		expect(html).toContain(">100<");
	});

	test("with no reads today it shows zero and no age", () => {
		const html = renderToStaticMarkup(
			<OverviewRowsRow now={NOW} data={under} />,
		);
		expect(html).toContain("250,000 this month");
		expect(html).not.toContain("free 1M used up");
		expect(html).toContain(">0<");
	});
});
