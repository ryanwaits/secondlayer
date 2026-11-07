import { describe, expect, it } from "bun:test";
import { SessionRegistry } from "./http-sessions.ts";

function fakeTransport() {
	return {
		closed: 0,
		async close() {
			this.closed++;
		},
	};
}

describe("HTTP session registry", () => {
	it("evicts and closes a session idle past the TTL", async () => {
		let clock = 0;
		const registry = new SessionRegistry(1000, () => clock);
		const idle = fakeTransport();
		registry.add("idle", idle);

		clock = 1001;
		expect(await registry.sweep()).toEqual(["idle"]);
		expect(idle.closed).toBe(1);
		expect(registry.get("idle")).toBeUndefined();
		expect(registry.size).toBe(0);
	});

	it("keeps a session that was used inside the TTL", async () => {
		let clock = 0;
		const registry = new SessionRegistry(1000, () => clock);
		const active = fakeTransport();
		registry.add("active", active);

		clock = 900;
		expect(registry.get("active")).toBe(active);
		clock = 1500;
		expect(await registry.sweep()).toEqual([]);
		expect(active.closed).toBe(0);
		expect(registry.get("active")).toBe(active);
	});

	it("one failing close does not stop the others being evicted", async () => {
		let clock = 0;
		const registry = new SessionRegistry(10, () => clock);
		const good = fakeTransport();
		registry.add("bad", {
			close: async () => {
				throw new Error("boom");
			},
		});
		registry.add("good", good);
		clock = 100;
		expect((await registry.sweep()).sort()).toEqual(["bad", "good"]);
		expect(good.closed).toBe(1);
	});
});
