import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CATALOG,
	type Catalog,
	type Spec,
	validateSpec,
} from "../../../../../../../skills/secondlayer/dash/template/kit.js";
import { demoBody } from "./dash-demo";
import { shadowKitCss } from "./dash-preview";

const TEMPLATE = join(
	import.meta.dir,
	"../../../../../../../skills/secondlayer/dash/template",
);
const catalog = JSON.parse(
	readFileSync(join(TEMPLATE, "catalog.json"), "utf8"),
) as Catalog;
const spec = JSON.parse(
	readFileSync(join(TEMPLATE, "../recipes/webhook-health.json"), "utf8"),
) as Spec;

const webhooks = (network: string) =>
	(demoBody(`/api/sl/${network}/api/webhooks`) as { data: { id: string }[] })
		.data;

describe("dashboard preview on /docs/mcp", () => {
	test("draws the skill's own webhook-health recipe, which validates", () => {
		expect(validateSpec(spec, catalog)).toEqual([]);
	});

	test("the example account answers every read the recipe's components make", () => {
		const health = demoBody("/api/sl/health") as Record<string, unknown>;
		const networks = Object.keys(health);
		expect(networks).toEqual(["mainnet", "testnet"]);
		for (const network of networks) {
			for (const el of Object.values(spec.elements)) {
				const reads = CATALOG[el.type]?.reads(el.props ?? {}, undefined) ?? [];
				for (const read of reads) {
					for (const { id } of webhooks(network)) {
						const path = `/api/sl/${network}${read.replace("{id}", id)}`;
						expect({ path, body: demoBody(path) !== null }).toEqual({
							path,
							body: true,
						});
					}
				}
			}
		}
	});

	test("every delivery opens to a payload", () => {
		for (const { id } of webhooks("mainnet")) {
			const { data } = demoBody(
				`/api/sl/mainnet/api/webhooks/${id}/deliveries`,
			) as { data: { id: string }[] };
			for (const d of data) {
				const detail = demoBody(
					`/api/sl/mainnet/api/webhooks/${id}/deliveries/${d.id}`,
				) as { payload: unknown };
				expect(detail.payload).not.toBeNull();
			}
		}
	});

	test("kit.css page rules land on the shadow host, never the docs page", () => {
		const css = shadowKitCss(readFileSync(join(TEMPLATE, "kit.css"), "utf8"));
		expect(css).not.toMatch(/:root|^body\b/m);
		expect(css).toContain(":host {");
	});
});
