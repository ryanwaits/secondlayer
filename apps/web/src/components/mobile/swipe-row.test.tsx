import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SwipeRow } from "./swipe-row";

const noop = () => {};

describe("SwipeRow", () => {
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
