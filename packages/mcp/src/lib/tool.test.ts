import { describe, expect, it } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@secondlayer/sdk";
import { defineTool } from "./tool.ts";

type Handler = (args: Record<string, unknown>) => Promise<{
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}>;

/** Register a tool whose handler throws `thrown`, return the parsed error payload. */
async function errorFrom(thrown: unknown) {
	let handler: Handler | undefined;
	const server = {
		tool: (_n: string, _d: string, _s: unknown, h: Handler) => {
			handler = h;
		},
	} as unknown as McpServer;
	defineTool(server, "throwaway", "throws", {}, async () => {
		throw thrown;
	});
	const result = await (handler as Handler)({});
	expect(result.isError).toBe(true);
	return JSON.parse(result.content[0]?.text ?? "").error;
}

const FEEDBACK = { url: "https://api.secondlayer.tools/v1/feedback" };

describe("defineTool error payload", () => {
	it("passes code, request_id and feedback through from the API body", async () => {
		const error = await errorFrom(
			Object.assign(new Error("Column 'cycle' does not exist"), {
				status: 400,
				code: "INVALID_COLUMN",
				body: {
					error: "Column 'cycle' does not exist",
					code: "INVALID_COLUMN",
					request_id: "req_abc12345",
					feedback: FEEDBACK,
				},
			}),
		);
		expect(error).toEqual({
			type: "error",
			status: 400,
			message: "Column 'cycle' does not exist",
			code: "INVALID_COLUMN",
			request_id: "req_abc12345",
			feedback: FEEDBACK,
		});
	});

	it("reads a real SDK ApiError without a feedback key when none was sent", async () => {
		const error = await errorFrom(
			new ApiError(
				404,
				"Subgraph not found",
				{
					error: "Subgraph not found",
					code: "SUBGRAPH_NOT_FOUND",
					request_id: "req_nf000001",
				},
				"SUBGRAPH_NOT_FOUND",
			),
		);
		expect(error.type).toBe("not_found");
		expect(error.code).toBe("SUBGRAPH_NOT_FOUND");
		expect(error.request_id).toBe("req_nf000001");
		expect("feedback" in error).toBe(false);
	});

	it("leaves a plain Error payload unchanged", async () => {
		expect(await errorFrom(new Error("boom"))).toEqual({
			type: "error",
			status: 0,
			message: "boom",
		});
	});

	it("drops a malformed feedback value", async () => {
		const error = await errorFrom(
			Object.assign(new Error("x"), {
				status: 400,
				body: { request_id: "req_abc12345", feedback: "nope" },
			}),
		);
		expect(error.request_id).toBe("req_abc12345");
		expect("feedback" in error).toBe(false);
	});
});
