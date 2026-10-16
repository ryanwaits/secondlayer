import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RatesTable } from "./rates-table";

const html = renderToStaticMarkup(<RatesTable />);

describe("RatesTable", () => {
	test("lists the five meters in order", () => {
		const labels = [
			"Rows",
			"Webhook events",
			"Hosted stack",
			"Minimum",
			"Always free",
		];
		const found = [...html.matchAll(/<th scope="row">([^<]+)<\/th>/g)].map(
			(m) => m[1],
		);
		expect(found).toEqual(labels);
	});

	test("prints every rate from the price table", () => {
		for (const text of ["$5", "$2", "$10", "0.028", "$5/mo", "$10/mo", "1M"]) {
			expect(html).toContain(text);
		}
	});

	test("uses no em dash", () => {
		expect(html).not.toContain("—");
	});
});
