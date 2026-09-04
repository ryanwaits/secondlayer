import { describe, expect, it } from "bun:test";
import { Cl } from "../../../clarity/values.ts";
import type { Client } from "../../../clients/types.ts";
import {
	MalformedResponseError,
	ReadContractError,
} from "../../../errors/response.ts";
import { readContract } from "../readContract.ts";

function mockClient(resp: unknown): Client {
	return { request: async () => resp } as unknown as Client;
}

const CONTRACT = "SP000000000000000000002Q6VF78.pox-4";

describe("readContract", () => {
	it("deserializes the result on okay:true", async () => {
		const result = await readContract(
			mockClient({ okay: true, result: Cl.serialize(Cl.uint(7n)) }),
			{ contract: CONTRACT, functionName: "get-stacker-info" },
		);
		expect(result).toEqual(Cl.uint(7n));
	});

	it("throws MalformedResponseError when okay:true but result is missing", async () => {
		await expect(
			readContract(mockClient({ okay: true }), {
				contract: CONTRACT,
				functionName: "get-stacker-info",
			}),
		).rejects.toThrow(MalformedResponseError);
	});

	it("throws MalformedResponseError when okay:true but result is null", async () => {
		await expect(
			readContract(mockClient({ okay: true, result: null }), {
				contract: CONTRACT,
				functionName: "get-stacker-info",
			}),
		).rejects.toThrow(MalformedResponseError);
	});

	it("throws ReadContractError on okay:false, message is the node cause", async () => {
		await expect(
			readContract(
				mockClient({ okay: false, cause: "Unchecked(NoSuchContract)" }),
				{ contract: CONTRACT, functionName: "missing" },
			),
		).rejects.toThrow(ReadContractError);

		try {
			await readContract(
				mockClient({ okay: false, cause: "Unchecked(NoSuchContract)" }),
				{ contract: CONTRACT, functionName: "missing" },
			);
		} catch (e) {
			expect(e).toBeInstanceOf(ReadContractError);
			expect((e as ReadContractError).code).toBe("READ_CONTRACT_ERROR");
			expect((e as ReadContractError).shortMessage).toBe(
				"Unchecked(NoSuchContract)",
			);
		}
	});

	it("throws ReadContractError with a fallback message when cause is missing", async () => {
		await expect(
			readContract(mockClient({ okay: false }), {
				contract: CONTRACT,
				functionName: "missing",
			}),
		).rejects.toThrow("Read-only call failed");
	});
});
