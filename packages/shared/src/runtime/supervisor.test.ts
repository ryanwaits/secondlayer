import { describe, expect, test } from "bun:test";
import { createMemoryModule } from "./modules.ts";
import { createSupervisor } from "./supervisor.ts";

describe("unified supervisor", () => {
	test("a failed module degrades health; siblings stay running", async () => {
		const api = createMemoryModule("api");
		const decoder = createMemoryModule("decoder", { failStart: true });
		const supervisor = createSupervisor([api, decoder]);
		await supervisor.start(["api", "decoder"]);
		const health = supervisor.health();
		expect(health.status).toBe("degraded");
		expect(health.modules.find((m) => m.id === "api")?.state).toBe("running");
		expect(health.modules.find((m) => m.id === "decoder")?.state).toBe(
			"failed",
		);
	});

	test("restarting one module increments only that restart count", async () => {
		const api = createMemoryModule("api");
		const ingest = createMemoryModule("ingest");
		const supervisor = createSupervisor([api, ingest]);
		await supervisor.start(["api", "ingest"]);
		await supervisor.restart("ingest");
		const health = supervisor.health();
		expect(health.modules.find((m) => m.id === "api")?.restarts).toBe(0);
		expect(health.modules.find((m) => m.id === "ingest")?.restarts).toBe(1);
		expect(health.modules.find((m) => m.id === "api")?.state).toBe("running");
	});

	test("a looping module is contained and does not stop reads", async () => {
		const api = createMemoryModule("api");
		const subgraph = createMemoryModule("subgraph", { loop: true });
		const supervisor = createSupervisor([api, subgraph]);
		await supervisor.start(["api", "subgraph"]);
		const health = supervisor.health();
		expect(health.modules.find((m) => m.id === "api")?.state).toBe("running");
		expect(health.modules.find((m) => m.id === "subgraph")?.state).toBe(
			"failed",
		);
		expect(health.status).toBe("degraded");
	});
});
