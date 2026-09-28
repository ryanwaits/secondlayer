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
				service={null}
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
				service={null}
				onRetry={() => {}}
			/>,
		);
		expect(html).toContain("load usage for September 2026");
		expect(html).toContain("Retry");
		expect(html).not.toBe("");
	});

	test("ok with no rows renders the empty-month box, not the error box", () => {
		const html = renderToStaticMarkup(
			<UsageBody
				status="ok"
				month={month}
				rows={[]}
				service={null}
				onRetry={() => {}}
			/>,
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
				service={null}
				onRetry={() => {}}
			/>,
		);
		expect(html).toContain("Free Index and Streams rows");
		expect(html).toContain("Webhooks are billed per");
		expect(html).toContain("Rows delivered");
		expect(html).not.toContain("load usage for");
	});

	test("a memory.gb_hour row notes (minimum) when billed above observed", () => {
		const html = renderToStaticMarkup(
			<UsageBody
				status="ok"
				month={month}
				rows={[{ unit: "memory.gb_hour", quantity: "12", usdMicros: "336000" }]}
				service={{
					state: "running",
					lastChargedAt: "2026-09-28T17:00:00.000Z",
					memory24h: [
						{
							hour: "2026-09-28T17:00:00.000Z",
							billedGb: 0.5,
							observedGb: 0.3,
						},
					],
				}}
				onRetry={() => {}}
			/>,
		);
		expect(html).toContain("(minimum)");
	});

	test("no (minimum) note when billed matches observed", () => {
		const html = renderToStaticMarkup(
			<UsageBody
				status="ok"
				month={month}
				rows={[{ unit: "memory.gb_hour", quantity: "12", usdMicros: "336000" }]}
				service={{
					state: "running",
					lastChargedAt: "2026-09-28T17:00:00.000Z",
					memory24h: [
						{
							hour: "2026-09-28T17:00:00.000Z",
							billedGb: 0.8,
							observedGb: 0.8,
						},
					],
				}}
				onRetry={() => {}}
			/>,
		);
		expect(html).not.toContain("(minimum)");
	});
});
