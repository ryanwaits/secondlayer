import { describe, expect, it } from "bun:test";
import { DeployWorkflowRequestSchema } from "../src/schemas/workflows.ts";

describe("DeployWorkflowRequestSchema", () => {
	const base = {
		name: "whale-alert",
		trigger: { type: "manual" },
		handlerCode: "export default {};",
	};

	it("accepts minimum required fields", () => {
		const result = DeployWorkflowRequestSchema.parse(base);
		expect(result.name).toBe("whale-alert");
		expect(result.sourceCode).toBeUndefined();
		expect(result.expectedVersion).toBeUndefined();
	});

	it("accepts sourceCode + expectedVersion", () => {
		const result = DeployWorkflowRequestSchema.parse({
			...base,
			sourceCode: "export default {};",
			expectedVersion: "1.0.0",
		});
		expect(result.sourceCode).toBe("export default {};");
		expect(result.expectedVersion).toBe("1.0.0");
	});

	it("rejects malformed expectedVersion", () => {
		expect(() =>
			DeployWorkflowRequestSchema.parse({ ...base, expectedVersion: "v1" }),
		).toThrow();
	});
});
