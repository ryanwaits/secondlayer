import { describe, expect, test } from "bun:test";
import { UNDERSIZED_OVERRIDE, decidePreflight } from "./preflight.ts";
import { measureDiskGb, measureRamMb, measureResources } from "./resources.ts";

const MAINNET_OK = {
	snapshot: { ramMb: 8192, diskGb: 800, postgresMaxConnections: 100 },
	unknown: [],
};

describe("boot preflight", () => {
	test("an adequate mainnet box passes silently", () => {
		const decision = decidePreflight({
			measured: MAINNET_OK,
			mode: "external",
			network: "mainnet",
		});
		expect(decision.action).toBe("pass");
		expect(decision.messages).toEqual([]);
	});

	test("an undersized box refuses to start", () => {
		const decision = decidePreflight({
			measured: {
				snapshot: { ramMb: 8192, diskGb: 100, postgresMaxConnections: 100 },
				unknown: [],
			},
			mode: "external",
			network: "mainnet",
		});
		expect(decision.action).toBe("refuse");
		expect(decision.messages.some((m) => m.includes("disk"))).toBe(true);
		// The refusal must tell the operator how to proceed, or they are stuck.
		expect(decision.messages.some((m) => m.includes(UNDERSIZED_OVERRIDE))).toBe(
			true,
		);
	});

	test("the override downgrades refusal to a warning", () => {
		// An operator whose box is already undersized must be able to bring their
		// install back up. Enforcing a new floor should never strand a running
		// instance during a restart.
		const decision = decidePreflight({
			measured: {
				snapshot: { ramMb: 8192, diskGb: 100, postgresMaxConnections: 100 },
				unknown: [],
			},
			mode: "external",
			network: "mainnet",
			env: { [UNDERSIZED_OVERRIDE]: "true" },
		});
		expect(decision.action).toBe("warn");
		expect(decision.messages.some((m) => m.includes("at your own risk"))).toBe(
			false,
		);
		expect(decision.messages.some((m) => m.includes("starting anyway"))).toBe(
			true,
		);
	});

	test("an unmeasurable dimension warns rather than refusing", () => {
		// Failing to boot because statfs was unavailable would turn a diagnostic
		// into an outage.
		const decision = decidePreflight({
			measured: {
				snapshot: { ramMb: 8192, postgresMaxConnections: 100 },
				unknown: ["disk (/data unreadable)"],
			},
			mode: "external",
			network: "mainnet",
		});
		expect(decision.action).toBe("warn");
		expect(decision.messages.some((m) => m.includes("could not measure"))).toBe(
			true,
		);
	});

	test("a missing disk reading is not treated as a zero-byte disk", () => {
		const decision = decidePreflight({
			measured: { snapshot: { ramMb: 8192 }, unknown: ["disk"] },
			mode: "external",
			network: "mainnet",
		});
		expect(decision.action).not.toBe("refuse");
	});

	test("testnet is not refused for lacking mainnet-sized disk", () => {
		const decision = decidePreflight({
			measured: {
				snapshot: { ramMb: 8192, diskGb: 120, postgresMaxConnections: 100 },
				unknown: [],
			},
			mode: "external",
			network: "testnet",
		});
		expect(decision.action).toBe("pass");
	});
});

describe("resource measurement", () => {
	test("reports this machine's RAM", async () => {
		const ram = await measureRamMb();
		expect(ram).toBeGreaterThan(0);
	});

	test("disk reports TOTAL capacity, not free space", async () => {
		// The distinction this guards: a healthy instance legitimately fills most
		// of its disk. Measuring free space would refuse to restart exactly the
		// installs that are working.
		const total = await measureDiskGb(process.cwd());
		expect(total).toBeGreaterThan(0);

		const { statfs } = await import("node:fs/promises");
		const stats = await statfs(process.cwd());
		const freeGb = Math.floor(
			(Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3,
		);
		expect(total).toBeGreaterThanOrEqual(freeGb);
	});

	test("an unreadable path is unknown, not zero", async () => {
		const measured = await measureResources({
			dataDir: "/definitely/not/a/real/path/xyzzy",
		});
		expect(measured.snapshot.diskGb).toBeUndefined();
		expect(measured.unknown.some((u) => u.startsWith("disk"))).toBe(true);
	});

	test("no database handle is unknown, not a failing connection count", async () => {
		const measured = await measureResources({ dataDir: process.cwd() });
		expect(measured.snapshot.postgresMaxConnections).toBeUndefined();
		expect(measured.unknown.some((u) => u.includes("max_connections"))).toBe(
			true,
		);
	});
});
