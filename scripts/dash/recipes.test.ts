import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import catalogJson from "../../skills/secondlayer/dash/template/catalog.json";
import {
	type Catalog,
	validateSpec,
} from "../../skills/secondlayer/dash/template/kit.js";

const DASH = join(import.meta.dir, "..", "..", "skills", "secondlayer", "dash");
const catalog = catalogJson as Catalog;

const recipes = readdirSync(join(DASH, "recipes")).filter((f) =>
	f.endsWith(".json"),
);

describe("dash specs", () => {
	test("ships the five recipes", () => {
		expect(recipes.sort()).toEqual([
			"failing-webhook.json",
			"subgraph-flows.json",
			"subgraph-rows.json",
			"usage.json",
			"webhook-health.json",
		]);
	});

	for (const file of [
		...recipes.map((f) => join("recipes", f)),
		join("template", "spec.json"),
	]) {
		test(`${file} passes validateSpec`, async () => {
			const spec = await Bun.file(join(DASH, file)).json();
			expect(validateSpec(spec, catalog)).toEqual([]);
		});
	}
});
