import { describe, expect, it } from "bun:test";
import { DeploySubgraphRequestSchema } from "./subgraphs.ts";

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
