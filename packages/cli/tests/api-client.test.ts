import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { StacksApiClient } from "../src/utils/api.ts";

let mockServer: ReturnType<typeof Bun.serve>;
const MOCK_PORT = 19444;
const CONTRACT_ID = "SP1234567890123456789012345678901234567890.demo";
const ABI = { functions: [], maps: [], variables: [], fungible_tokens: [] };

let lastPath = "";
let lastAuthorization: string | null = null;
let failureRequests = 0;

beforeAll(() => {
	mockServer = Bun.serve({
		port: MOCK_PORT,
		fetch(req) {
			const url = new URL(req.url);
			lastPath = url.pathname;
			lastAuthorization = req.headers.get("authorization");

			if (url.pathname === `/v1/contracts/${CONTRACT_ID}`) {
				return Response.json({ contract: { abi: ABI, abi_status: "ok" } });
			}

			if (url.pathname === "/v1/contracts/SP123.fail") {
				failureRequests += 1;
				return Response.json({ error: "node unavailable" }, { status: 502 });
			}

			if (url.pathname === "/v1/contracts/SP123.unauth") {
				return new Response("Unauthorized", { status: 401 });
			}

			return new Response("Not Found", { status: 404 });
		},
	});
});

afterAll(() => {
	mockServer.stop();
});

describe("StacksApiClient", () => {
	test("fetches mainnet ABIs through the Secondlayer contract registry", async () => {
		const client = new StacksApiClient(
			"mainnet",
			undefined,
			`http://localhost:${MOCK_PORT}/`,
		);

		const abi = await client.getContractInfo(CONTRACT_ID);

		expect(abi).toEqual(ABI);
		expect(lastPath).toBe(`/v1/contracts/${CONTRACT_ID}`);
		expect(lastAuthorization).toBeNull();
		expect(client.describeContractInfoSource()).toBe("Secondlayer node");
	});

	test("does not retry ABI failures for minutes", async () => {
		failureRequests = 0;
		const client = new StacksApiClient(
			"mainnet",
			undefined,
			`http://localhost:${MOCK_PORT}`,
		);

		await expect(client.getContractInfo("SP123.fail")).rejects.toThrow(
			"Failed to fetch contract",
		);
		expect(failureRequests).toBe(1);
	});

	test("ABI 401 points at login or INSTANCE_TOKEN, not a deleted command", async () => {
		const client = new StacksApiClient(
			"mainnet",
			undefined,
			`http://localhost:${MOCK_PORT}`,
		);

		const err = await client.getContractInfo("SP123.unauth").then(
			() => {
				throw new Error("expected 401");
			},
			(e: unknown) => (e instanceof Error ? e.message : String(e)),
		);
		expect(err).not.toContain("auth login");
		expect(err).toMatch(/secondlayer login|INSTANCE_TOKEN/);
	});
});
