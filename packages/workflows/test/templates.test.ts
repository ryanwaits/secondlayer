import { describe, expect, test } from "bun:test";
import { bundleWorkflowCode } from "@secondlayer/bundler";
import { templates } from "../src/templates.ts";

describe("workflow templates", () => {
	test("exports six seed templates", () => {
		expect(templates).toHaveLength(6);
		const ids = templates.map((t) => t.id);
		expect(ids).toEqual([
			"whale-alert",
			"mint-watcher",
			"price-circuit-breaker",
			"daily-digest",
			"failed-tx-alert",
			"health-cron",
		]);
	});

	test.each(templates.map((t) => [t.id, t]))(
		"%s bundles + validates",
		async (_id, template) => {
			const bundled = await bundleWorkflowCode(template.code);
			expect(bundled.name).toBeTruthy();
			expect(bundled.trigger).toBeTruthy();
		},
	);
});
