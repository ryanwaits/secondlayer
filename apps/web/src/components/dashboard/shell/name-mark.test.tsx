import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NameMark } from "./name-mark";

const html = (tone: Parameters<typeof NameMark>[0]["tone"]) =>
	renderToStaticMarkup(<NameMark tone={tone}>orders</NameMark>);

describe("NameMark", () => {
	test("healthy renders the bare name with no dot", () => {
		expect(html("ok")).toBe("orders");
	});

	test("failing wraps the name in the red flag, with no dot", () => {
		const out = html("alarm");
		expect(out).toContain('class="name-flag"');
		expect(out).not.toContain("dash-dot");
	});

	test("warning keeps a dot before the name", () => {
		expect(html("hi")).toBe('<span class="dash-dot hi"></span>orders');
	});

	test("idle keeps a dot before the name", () => {
		expect(html("idle")).toBe('<span class="dash-dot idle"></span>orders');
	});
});
