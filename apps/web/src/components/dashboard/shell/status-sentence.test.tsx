import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusSentence, type Tone, dotClass } from "./status-sentence";

describe("StatusSentence", () => {
	test("maps each tone to its dot class", () => {
		const cases: [Tone, string][] = [
			["ok", 'class="dash-dot"'],
			["alarm", 'class="dash-dot alarm"'],
			["hi", 'class="dash-dot hi"'],
			["idle", 'class="dash-dot idle"'],
		];
		for (const [tone, cls] of cases) {
			expect(
				renderToStaticMarkup(
					<StatusSentence tone={tone}>All healthy</StatusSentence>,
				),
			).toContain(cls);
			expect(`class="${dotClass(tone)}"`).toBe(cls);
		}
	});

	test("renders the sub-line only when given", () => {
		const without = renderToStaticMarkup(
			<StatusSentence tone="ok">Fine</StatusSentence>,
		);
		const withSub = renderToStaticMarkup(
			<StatusSentence tone="ok" sub="2 webhooks">
				Fine
			</StatusSentence>,
		);
		expect(without).not.toContain("dash-status-sub");
		expect(withSub).toContain("dash-status-sub");
	});
});
