import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NameTip } from "./name-tip";

describe("NameTip", () => {
	test("wraps the name in a button carrying its tooltip", () => {
		const html = renderToStaticMarkup(
			<NameTip tip="Click for details" onOpen={() => {}}>
				alex-swaps
			</NameTip>,
		);
		expect(html).toBe(
			'<button type="button" class="name-tip" data-tip="Click for details">alex-swaps</button>',
		);
	});
});
