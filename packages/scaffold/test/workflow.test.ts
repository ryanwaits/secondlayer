import { describe, expect, test } from "bun:test";
import { bundleWorkflowCode } from "@secondlayer/bundler";
import { generateWorkflowCode } from "../src/workflow.ts";

describe("generateWorkflowCode", () => {
	test("manual trigger round-trips through bundler", async () => {
		const src = generateWorkflowCode({
			name: "manual-test",
			trigger: { type: "manual" },
			steps: ["run"],
		});
		const bundled = await bundleWorkflowCode(src);
		expect(bundled.name).toBe("manual-test");
		expect(bundled.trigger.type).toBe("manual");
	});

	test("event trigger + ai + slack delivery round-trips", async () => {
		const src = generateWorkflowCode({
			name: "whale-alert",
			trigger: { type: "event", filterType: "stx_transfer" },
			steps: ["ai", "deliver"],
			deliveryTarget: "slack",
		});
		const bundled = await bundleWorkflowCode(src);
		expect(bundled.name).toBe("whale-alert");
		expect(bundled.trigger.type).toBe("event");
	});

	test("schedule trigger round-trips", async () => {
		const src = generateWorkflowCode({
			name: "daily-digest",
			trigger: { type: "schedule", cron: "0 9 * * *", timezone: "UTC" },
			steps: ["run", "ai", "deliver"],
			deliveryTarget: "email",
		});
		const bundled = await bundleWorkflowCode(src);
		expect(bundled.name).toBe("daily-digest");
		expect(bundled.trigger.type).toBe("schedule");
	});
});
