import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HoldButton } from "./hold-button";

describe("HoldButton", () => {
	const html = renderToStaticMarkup(
		<HoldButton label="Hold to revoke ci-runner" onConfirm={() => {}} />,
	);
	test("shows the label while idle", () => {
		expect(html).toContain("<span>Hold to revoke ci-runner</span>");
		expect(html).not.toContain("is-holding");
	});
	test("describes itself with the hidden hint", () => {
		const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
		expect(id).toBeTruthy();
		expect(html).toContain(`id="${id}"`);
		expect(html).toContain("Press and hold for 1.2 seconds to confirm.");
	});
	test("the fill duration comes from durationMs", () => {
		expect(html).toContain("--hold-ms:1200ms");
		expect(
			renderToStaticMarkup(
				<HoldButton label="x" onConfirm={() => {}} durationMs={1000} />,
			),
		).toContain("--hold-ms:1000ms");
	});
});
