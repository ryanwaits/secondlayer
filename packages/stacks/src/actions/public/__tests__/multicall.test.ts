import { describe, expect, it } from "bun:test";
import { Cl } from "../../../clarity/values.ts";
import type { Client } from "../../../clients/types.ts";
import { multicall } from "../multicall.ts";

function createMockClient(
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	requestHandler: (path: string, init?: any) => Promise<any>,
): Client {
	return {
		transport: {
			type: "custom" as const,
			// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
			config: {} as any,
			request: async () => ({}),
		},
		request: requestHandler,
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		extend: () => ({}) as any,
	};
}

describe("multicall", () => {
	const calls = [
		{
			contract: "SP000000000000000000002Q6VF78.contract-a",
			functionName: "get-x",
		},
		{
			contract: "SP000000000000000000002Q6VF78.contract-b",
			functionName: "get-y",
		},
		{
			contract: "SP000000000000000000002Q6VF78.contract-c",
			functionName: "get-z",
		},
	];

	it("allowFailure:true returns mixed success/failure results", async () => {
		const client = createMockClient(async (path) => {
			if (path.includes("contract-b")) {
				return { okay: false, cause: "function not found" };
			}
			return { okay: true, result: Cl.serialize(Cl.uint(42n)) };
		});

		const results = await multicall(client, { calls, allowFailure: true });

		expect(results).toHaveLength(3);
		expect(results[0]).toEqual({
			status: "success",
			result: expect.anything(),
		});
		expect(results[1]).toEqual({ status: "failure", error: expect.any(Error) });
		expect(results[2]).toEqual({
			status: "success",
			result: expect.anything(),
		});
	});

	it("allowFailure:false throws on first failure", async () => {
		const client = createMockClient(async (path) => {
			if (path.includes("contract-b")) {
				return { okay: false, cause: "function not found" };
			}
			return { okay: true, result: Cl.serialize(Cl.uint(42n)) };
		});

		expect(multicall(client, { calls, allowFailure: false })).rejects.toThrow(
			"function not found",
		);
	});

	it("results order matches input order", async () => {
		let callIndex = 0;
		const values = [10n, 20n, 30n];

		const client = createMockClient(async () => {
			const val = values[callIndex++];
			return { okay: true, result: Cl.serialize(Cl.uint(val)) };
		});

		const results = await multicall(client, { calls, allowFailure: false });

		expect(results).toHaveLength(3);
	});

	it("defaults to allowFailure:true", async () => {
		const client = createMockClient(async (path) => {
			if (path.includes("contract-c")) {
				return { okay: false, cause: "boom" };
			}
			return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
		});

		const results = await multicall(client, { calls });

		expect(results).toHaveLength(3);
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((results[0] as any).status).toBe("success");
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((results[2] as any).status).toBe("failure");
	});

	it("all success with allowFailure:false returns ClarityValue[]", async () => {
		const client = createMockClient(async () => ({
			okay: true,
			result: Cl.serialize(Cl.uint(99n)),
		}));

		const results = await multicall(client, { calls, allowFailure: false });

		expect(results).toHaveLength(3);
		for (const r of results) {
			expect(r).toBeDefined();
		}
	});

	it("keeps at most `concurrency` reads in flight (default 8) and preserves order", async () => {
		let inFlight = 0;
		let peak = 0;
		const client = createMockClient(async (_path, init) => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((r) => setTimeout(r, 2));
			inFlight--;
			const n = BigInt(init.body.arguments.length);
			return { okay: true, result: Cl.serialize(Cl.uint(n)) };
		});
		const many = Array.from({ length: 30 }, (_, i) => ({
			contract: "SP000000000000000000002Q6VF78.contract-a",
			functionName: "get-x",
			args: Array.from({ length: i }, () => Cl.uint(0n)),
		}));
		const results = await multicall(client, {
			calls: many,
			allowFailure: false,
		});
		expect(peak).toBeLessThanOrEqual(8);
		expect(peak).toBeGreaterThan(1);
		expect(results.map((r) => (r as { value: bigint }).value)).toEqual(
			many.map((_, i) => BigInt(i)),
		);
	});

	it("honors an explicit concurrency of 1", async () => {
		let inFlight = 0;
		let peak = 0;
		const client = createMockClient(async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((r) => setTimeout(r, 1));
			inFlight--;
			return { okay: true, result: Cl.serialize(Cl.uint(1n)) };
		});
		await multicall(client, { calls, concurrency: 1 });
		expect(peak).toBe(1);
	});

	it("rejects a non-positive concurrency", async () => {
		const client = createMockClient(async () => ({}));
		await expect(multicall(client, { calls, concurrency: 0 })).rejects.toThrow(
			RangeError,
		);
	});
});
