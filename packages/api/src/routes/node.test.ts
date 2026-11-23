import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { StacksNodeClient } from "@secondlayer/shared/node";
import nodeRouter from "./node.ts";

const CONTRACT = "SP000000000000000000002Q6VF78.pox-4";

describe("contract ABI proxy", () => {
	const abiSpy = spyOn(StacksNodeClient.prototype, "getContractAbi");

	afterEach(() => {
		abiSpy.mockReset();
	});

	test("an unreachable node's 502 does not leak its address", async () => {
		abiSpy.mockRejectedValue(
			new Error("Unable to connect to http://10.0.0.5:20443/v2/contracts"),
		);
		const res = await nodeRouter.request(`/contracts/${CONTRACT}/abi`);
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(JSON.parse(text)).toEqual({ error: "Failed to fetch contract ABI" });
		expect(text).not.toContain("10.0.0.5");
		expect(text).not.toContain("20443");
	});

	test("a node 404 is still a 404", async () => {
		abiSpy.mockRejectedValue(new Error("HTTP 404 Not Found"));
		const res = await nodeRouter.request(`/contracts/${CONTRACT}/abi`);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Contract not found" });
	});
});
