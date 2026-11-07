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

	test("starting a module that is already live does not start it twice", async () => {
		let starts = 0;
		const api = createMemoryModule("api", { onStart: () => starts++ });
		const supervisor = createSupervisor([api]);
		await supervisor.start(["api"]);
		await supervisor.start(["api"]);
		expect(starts).toBe(1);
	});

	test("a failed module can be started again", async () => {
		let starts = 0;
		const api = createMemoryModule("api", { onStart: () => starts++ });
		api.setState("failed");
		const supervisor = createSupervisor([api]);
		await supervisor.start(["api"]);
		expect(starts).toBe(1);
		expect(supervisor.health().modules[0]?.state).toBe("running");
	});

	test("stopping a module that is already stopped does not stop it again", async () => {
		let stops = 0;
		const api = createMemoryModule("api", { onStop: () => stops++ });
		const supervisor = createSupervisor([api]);
		await supervisor.start(["api"]);
		await supervisor.stop("api");
		await supervisor.stop("api");
		expect(stops).toBe(1);
	});

	test("restart stops then starts a live module exactly once each", async () => {
		let starts = 0;
		let stops = 0;
		const api = createMemoryModule("api", {
			onStart: () => starts++,
			onStop: () => stops++,
		});
		const supervisor = createSupervisor([api]);
		await supervisor.start(["api"]);
		await supervisor.restart("api");
		expect({ starts, stops }).toEqual({ starts: 2, stops: 1 });
	});
});
