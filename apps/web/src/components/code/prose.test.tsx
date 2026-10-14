import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Pick } from "./prose";

describe("Pick", () => {
	test("renders the default option as text before any script runs", () => {
		const out = renderToStaticMarkup(
			<Pick name="event" default="ft_transfer" />,
		);
		expect(out).toContain(
			'<span class="picker" data-picker="event">ft_transfer</span>',
		);
	});
});
