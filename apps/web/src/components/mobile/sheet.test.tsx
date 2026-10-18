import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Sheet, SheetPanel } from "./sheet";

describe("Sheet", () => {
	test("renders nothing while closed", () => {
		expect(
			renderToStaticMarkup(
				<Sheet open={false} onClose={() => {}} title="Failing">
					body
				</Sheet>,
			),
		).toBe("");
	});
});

describe("SheetPanel", () => {
	const html = renderToStaticMarkup(
		<SheetPanel
			title="Delivery failed"
			eyebrow="Webhook"
			detent="half"
			titleId="t1"
		>
			<p>body</p>
		</SheetPanel>,
	);
	test("is a modal dialog named by its heading", () => {
		expect(html).toContain('role="dialog"');
		expect(html).toContain('aria-modal="true"');
		expect(html).toContain('aria-labelledby="t1"');
		expect(html).toContain('<h2 id="t1">Delivery failed</h2>');
	});
	test("the detent picks the height class", () => {
		expect(html).toContain("is-half");
		expect(
			renderToStaticMarkup(
				<SheetPanel title="x" detent="full">
					y
				</SheetPanel>,
			),
		).toContain("is-full");
		expect(
			renderToStaticMarkup(
				<SheetPanel title="x" detent="auto">
					y
				</SheetPanel>,
			),
		).toContain("is-auto");
	});
	test("shows the eyebrow and a hidden grab handle", () => {
		expect(html).toContain("Webhook");
		expect(html).toContain('class="m-sheet-grab" aria-hidden="true"');
	});
});
