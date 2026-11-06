import { describe, expect, test } from "bun:test";
import { PRODUCTS } from "@/lib/site";

describe("marketing shell", () => {
	test("PRODUCTS lists the five products in brand order", () => {
		expect(PRODUCTS.map((p) => p.noun)).toEqual([
			"Archive",
			"Streams",
			"Index",
			"Subgraphs",
			"Webhooks",
		]);
	});
});
