import { describe, expect, it } from "bun:test";
import {
	BundleSizeError,
	SUBGRAPH_BUNDLE_MAX_BYTES,
	WORKFLOW_BUNDLE_MAX_BYTES,
} from "../src/errors.ts";
import { bundleSubgraphCode } from "../src/subgraph.ts";
import { bundleWorkflowCode } from "../src/workflow.ts";

function bigString(bytes: number): string {
	return "x".repeat(bytes);
}

describe("bundle size caps", () => {
	it("rejects workflow bundle larger than 1 MB", async () => {
		const payload = bigString(WORKFLOW_BUNDLE_MAX_BYTES + 1024);
		const source = `
import { defineWorkflow } from "@secondlayer/workflows";
const BIG = ${JSON.stringify(payload)};
export default defineWorkflow({
	name: "too-big",
	trigger: { type: "manual" },
	handler: async () => { return BIG.length; },
});
`;
		try {
			await bundleWorkflowCode(source);
			throw new Error("expected BundleSizeError");
		} catch (err) {
			expect(err).toBeInstanceOf(BundleSizeError);
			expect((err as BundleSizeError).kind).toBe("workflow");
			expect((err as BundleSizeError).actualBytes).toBeGreaterThan(
				WORKFLOW_BUNDLE_MAX_BYTES,
			);
		}
	});

	it("rejects subgraph bundle larger than 4 MB", async () => {
		const payload = bigString(SUBGRAPH_BUNDLE_MAX_BYTES + 1024);
		const source = `
import { defineSubgraph } from "@secondlayer/subgraphs";
const BIG = ${JSON.stringify(payload)};
export default defineSubgraph({
	name: "too-big",
	sources: { t: { type: "stx_transfer" } },
	schema: {
		transfers: {
			columns: {
				id: { type: "text", primaryKey: true },
			},
		},
	},
	handlers: {
		t: async () => { return BIG.length; },
	},
});
`;
		try {
			await bundleSubgraphCode(source);
			throw new Error("expected BundleSizeError");
		} catch (err) {
			expect(err).toBeInstanceOf(BundleSizeError);
			expect((err as BundleSizeError).kind).toBe("subgraph");
			expect((err as BundleSizeError).actualBytes).toBeGreaterThan(
				SUBGRAPH_BUNDLE_MAX_BYTES,
			);
		}
	}, 30_000);
});
