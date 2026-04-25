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

			if (url.pathname === `/api/node/contracts/${CONTRACT_ID}/abi`) {
				return Response.json(ABI);
			}

			if (
				url.pathname ===
				"/v2/contracts/interface/SP1234567890123456789012345678901234567890/demo"
			) {
				return Response.json(ABI);
			}

			if (url.pathname === "/api/node/contracts/SP123.fail/abi") {
				failureRequests += 1;
				return Response.json({ error: "node unavailable" }, { status: 502 });
			}

			return new Response("Not Found", { status: 404 });
		},
	});
});

afterAll(() => {
	mockServer.stop();
});

describe("StacksApiClient", () => {
	test("fetches mainnet ABIs through the Secondlayer node proxy", async () => {
		const client = new StacksApiClient(
			"mainnet",
			undefined,
			undefined,
			`http://localhost:${MOCK_PORT}/`,
		);

		const abi = await client.getContractInfo(CONTRACT_ID);

		expect(abi).toEqual(ABI);
		expect(lastPath).toBe(`/api/node/contracts/${CONTRACT_ID}/abi`);
		expect(lastAuthorization).toBeNull();
		expect(client.describeContractInfoSource()).toBe("Secondlayer node");
	});

	test("fetches devnet ABIs directly from the configured Stacks node RPC", async () => {
		const client = new StacksApiClient(
			"devnet",
			"node-key",
			`http://localhost:${MOCK_PORT}`,
		);

		const abi = await client.getContractInfo(CONTRACT_ID);

		expect(abi).toEqual(ABI);
		expect(lastPath).toBe(
			"/v2/contracts/interface/SP1234567890123456789012345678901234567890/demo",
		);
		expect(client.describeContractInfoSource()).toBe(
			`Stacks node RPC at http://localhost:${MOCK_PORT}`,
		);
	});

	test("does not retry ABI failures for minutes", async () => {
		failureRequests = 0;
		const client = new StacksApiClient(
			"mainnet",
			undefined,
			undefined,
			`http://localhost:${MOCK_PORT}`,
		);

		await expect(client.getContractInfo("SP123.fail")).rejects.toThrow(
			"Failed to fetch contract",
		);
		expect(failureRequests).toBe(1);
	});
});
