import { describe, expect, it } from "bun:test";
import { DeploySubgraphRequestSchema, syncState } from "./subgraphs.ts";

describe("syncState", () => {
	it("is synced at the tip and catching up behind it", () => {
		expect(syncState({ status: "active", lastProcessedBlock: 100 }, 100)).toBe(
			"synced",
		);
		expect(syncState({ status: "active", lastProcessedBlock: "99" }, 100)).toBe(
			"catching_up",
		);
	});

	it("reports reindexing and error whatever the cursor says", () => {
		expect(
			syncState({ status: "reindexing", lastProcessedBlock: 100 }, 100),
		).toBe("reindexing");
		expect(syncState({ status: "error", lastProcessedBlock: 100 }, 100)).toBe(
			"error",
		);
	});
});

const baseDeployRequest = {
	name: "demo-subgraph",
	sources: {
		events: { type: "print_event", contractId: "SP123.demo", topic: "event" },
	},
	schema: {
		events: {
			columns: {
				sender: { type: "principal" },
			},
		},
	},
	handlerCode: "export default {}",
};

describe("DeploySubgraphRequestSchema", () => {
	it("accepts an optional startBlock override", () => {
		expect(
			DeploySubgraphRequestSchema.safeParse({
				...baseDeployRequest,
				startBlock: 0,
			}).success,
		).toBe(true);
		expect(
			DeploySubgraphRequestSchema.safeParse({
				...baseDeployRequest,
				startBlock: 123,
			}).success,
		).toBe(true);
	});

	it("rejects invalid startBlock overrides", () => {
		expect(
			DeploySubgraphRequestSchema.safeParse({
				...baseDeployRequest,
				startBlock: -1,
			}).success,
		).toBe(false);
		expect(
			DeploySubgraphRequestSchema.safeParse({
				...baseDeployRequest,
				startBlock: 1.5,
			}).success,
		).toBe(false);
	});
});
