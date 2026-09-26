import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageBody } from "./usage-panel";

const month = { year: 2026, month: 8 }; // September (0-indexed)

describe("UsageBody", () => {
	test("not_loaded renders nothing", () => {
		const html = renderToStaticMarkup(
			<UsageBody
				status="not_loaded"
				month={month}
				rows={undefined}
				onRetry={() => {}}
			/>,
		);
		expect(html).toBe("");
	});

	test("failed renders an error with retry, not a blank panel", () => {
		const html = renderToStaticMarkup(
			<UsageBody
				status="failed"
				month={month}
				rows={undefined}
				onRetry={() => {}}
			/>,
		);
		expect(html).toContain("load usage for September 2026");
		expect(html).toContain("Retry");
		expect(html).not.toBe("");
	});

	test("ok with no rows renders the empty-month box, not the error box", () => {
		const html = renderToStaticMarkup(
			<UsageBody status="ok" month={month} rows={[]} onRetry={() => {}} />,
		);
		expect(html).toContain("No usage in September 2026");
		expect(html).not.toContain("load usage for");
	});

	test("ok with rows renders the meter and table", () => {
		const html = renderToStaticMarkup(
			<UsageBody
				status="ok"
				month={month}
				rows={[{ unit: "rows.delivered", quantity: "500000", usdMicros: "0" }]}
				onRetry={() => {}}
			/>,
		);
		expect(html).toContain("Free rows this month");
		expect(html).toContain("Rows delivered");
		expect(html).not.toContain("load usage for");
	});
});
