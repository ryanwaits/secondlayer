import { describe, expect, test } from "bun:test";
import { allEndpoints } from "./spec";

const docsCss = await Bun.file(new URL("../docs.css", import.meta.url)).text();
const globalsCss = await Bun.file(
	new URL("../../../globals.css", import.meta.url),
).text();

describe("method pills", () => {
	test("every HTTP method in the spec has a pill color in both themes", () => {
		const methods = new Set(
			allEndpoints().map((endpoint) => endpoint.method.toLowerCase()),
		);
		expect(methods.size).toBeGreaterThan(0);
		for (const method of methods) {
			expect(docsCss).toContain(`.apiref-verb-${method} {`);
			const tokens = globalsCss.match(new RegExp(`--verb-${method}:`, "g"));
			expect(tokens?.length).toBe(2);
		}
	});
});
