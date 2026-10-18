import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SwipeGroup, SwipeRow } from "./swipe-row";

const noop = () => {};

describe("SwipeRow", () => {
	const html = renderToStaticMarkup(
		<SwipeGroup>
			<SwipeRow
				id="a"
				actions={[
					{ label: "Pause", tone: "neutral", onAction: noop },
					{ label: "Replay", tone: "pri", onAction: noop },
				]}
			>
				ci-runner
			</SwipeRow>
		</SwipeGroup>,
	);
	test("renders each action as a real button with its tone", () => {
		expect(html).toContain(
			'<button type="button" class="m-act is-neutral">Pause</button>',
		);
		expect(html).toContain(
			'<button type="button" class="m-act is-pri">Replay</button>',
		);
	});
	test("the actions container is 76px per action", () => {
		expect(html).toContain("width:152px");
	});
	test("the face is a focusable button that starts closed", () => {
		expect(html).toContain('role="button"');
		expect(html).toContain('tabindex="0"');
		expect(html).not.toContain("is-open");
	});
	test("a single alarm action is 76px wide", () => {
		const one = renderToStaticMarkup(
			<SwipeRow
				id="b"
				actions={[{ label: "Revoke", tone: "alarm", onAction: noop }]}
			>
				x
			</SwipeRow>,
		);
		expect(one).toContain("width:76px");
		expect(one).toContain("m-act is-alarm");
	});
	test("zero or three actions throw in development", () => {
		const action = { label: "x", tone: "neutral" as const, onAction: noop };
		expect(() =>
			renderToStaticMarkup(
				<SwipeRow id="c" actions={[]}>
					x
				</SwipeRow>,
			),
		).toThrow();
		expect(() =>
			renderToStaticMarkup(
				<SwipeRow id="d" actions={[action, action, action]}>
					x
				</SwipeRow>,
			),
		).toThrow();
	});
});
