import { describe, expect, test } from "bun:test";
import {
	DEFAULT_PROFILE,
	MODULE_IDS,
	createMemoryModule,
	isModuleId,
} from "./modules.ts";

describe("lifecycle modules", () => {
	test("default profile starts every runtime plane except publisher", () => {
		expect(DEFAULT_PROFILE).not.toContain("publisher");
		expect(DEFAULT_PROFILE).toEqual([
			"api",
			"ingest",
			"decoder",
			"subgraph",
			"notification",
			"verification",
		]);
		expect(MODULE_IDS).toHaveLength(7);
	});

	test("an isolated restart does not start siblings", async () => {
		const started: string[] = [];
		const api = createMemoryModule("api", {
			onStart: () => started.push("api"),
		});
		const ingest = createMemoryModule("ingest", {
			onStart: () => started.push("ingest"),
		});
		await api.start();
		await ingest.start();
		await api.stop();
		await api.start();
		expect(started).toEqual(["api", "ingest", "api"]);
		expect(ingest.health().state).toBe("running");
	});

	test("isModuleId rejects unknown tokens", () => {
		expect(isModuleId("api")).toBe(true);
		expect(isModuleId("layer2")).toBe(false);
	});
});
