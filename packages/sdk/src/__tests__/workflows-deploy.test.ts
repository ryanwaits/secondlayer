import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { VersionConflictError } from "../errors.ts";
import { Workflows } from "../workflows/client.ts";

const BASE_URL = "http://localhost:3800";
const API_KEY = "test-key-123";

const originalFetch = globalThis.fetch;

function mockJsonFetch(status: number, body: unknown) {
	const fn = mock(() =>
		Promise.resolve({
			ok: status >= 200 && status < 300,
			status,
			headers: new Headers(),
			json: () => Promise.resolve(body),
			text: () => Promise.resolve(JSON.stringify(body)),
		} as Response),
	);
	globalThis.fetch = fn as unknown as typeof fetch;
	return fn;
}

describe("Workflows.deploy", () => {
	let client: Workflows;

	beforeEach(() => {
		client = new Workflows({ baseUrl: BASE_URL, apiKey: API_KEY });
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("sends x-sl-origin: cli by default", async () => {
		const fn = mockJsonFetch(200, {
			action: "created",
			workflowId: "w1",
			version: "1.0.0",
			message: "ok",
		});
		await client.deploy({
			name: "x",
			trigger: { type: "manual" },
			handlerCode: "export default {};",
		});
		const call = fn.mock.calls[0] as unknown as [string, RequestInit];
		const headers = call[1].headers as Record<string, string>;
		expect(headers["x-sl-origin"]).toBe("cli");
	});

	test("honours custom origin from constructor", async () => {
		const mcpClient = new Workflows({
			baseUrl: BASE_URL,
			apiKey: API_KEY,
			origin: "mcp",
		});
		const fn = mockJsonFetch(200, {
			action: "created",
			workflowId: "w1",
			version: "1.0.0",
			message: "ok",
		});
		await mcpClient.deploy({
			name: "x",
			trigger: { type: "manual" },
			handlerCode: "export default {};",
		});
		const call = fn.mock.calls[0] as unknown as [string, RequestInit];
		const headers = call[1].headers as Record<string, string>;
		expect(headers["x-sl-origin"]).toBe("mcp");
	});

	test("throws typed VersionConflictError on 409", async () => {
		mockJsonFetch(409, {
			error: "Version conflict: expected 9.9.9, current 1.0.0",
			code: "VERSION_CONFLICT",
			currentVersion: "1.0.0",
			expectedVersion: "9.9.9",
		});
		try {
			await client.deploy({
				name: "x",
				trigger: { type: "manual" },
				handlerCode: "export default {};",
				expectedVersion: "9.9.9",
			});
			throw new Error("expected VersionConflictError");
		} catch (err) {
			expect(err).toBeInstanceOf(VersionConflictError);
			const typed = err as VersionConflictError;
			expect(typed.currentVersion).toBe("1.0.0");
			expect(typed.expectedVersion).toBe("9.9.9");
			expect(typed.status).toBe(409);
		}
	});

	test("getSource returns source payload", async () => {
		mockJsonFetch(200, {
			name: "x",
			version: "1.0.0",
			sourceCode: "export default {};",
			readOnly: false,
			updatedAt: "2026-04-12T00:00:00.000Z",
		});
		const src = await client.getSource("x");
		expect(src.name).toBe("x");
		expect(src.sourceCode).toBe("export default {};");
		expect(src.readOnly).toBe(false);
	});

	test("dryRun returns validation result shape", async () => {
		mockJsonFetch(200, {
			valid: true,
			validation: { name: "x", triggerType: "manual" },
			bundleSize: 100,
		});
		const result = await client.deploy({
			name: "x",
			trigger: { type: "manual" },
			handlerCode: "export default {};",
			dryRun: true,
		});
		expect(result).toEqual({
			valid: true,
			validation: { name: "x", triggerType: "manual" },
			bundleSize: 100,
		});
	});
});
