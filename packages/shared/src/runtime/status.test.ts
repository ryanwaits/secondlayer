import { describe, expect, test } from "bun:test";
import { createMemoryModule } from "./modules.ts";
import { actionFor, reportRuntimeStatus } from "./status.ts";
import { createSupervisor } from "./supervisor.ts";

describe("status UX", () => {
	test("snapshots name every plane and a next action", async () => {
		const api = createMemoryModule("api");
		const ingest = createMemoryModule("ingest");
		const supervisor = createSupervisor([api, ingest]);
		await supervisor.start(["api", "ingest"]);
		const report = reportRuntimeStatus({
			supervisor: supervisor.health(),
			node: "connected",
			archive: "idle",
			disk: "ok",
			coverage: "lagging",
		});
		const planes = report.planes.map((p) => p.plane);
		expect(planes).toContain("node");
		expect(planes).toContain("raw");
		expect(planes).toContain("archive");
		expect(planes).toContain("disk");
		expect(planes).toContain("coverage");
		expect(report.planes.find((p) => p.plane === "coverage")?.action).toBe(
			"wait for catch-up",
		);
	});

	test("failed raw points at verify", () => {
		expect(actionFor("raw", "failed")).toBe(
			"sl verify all --against <manifest>",
		);
	});
});
