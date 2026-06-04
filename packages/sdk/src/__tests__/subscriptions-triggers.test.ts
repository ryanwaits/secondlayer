import { afterEach, describe, expect, test } from "bun:test";
import { SecondLayer } from "../index.ts";
import { on } from "../subscriptions/client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("on.* chain-trigger builders", () => {
	test("produce bare ChainTrigger objects with the right type tag", () => {
		expect(
			on.contractCall({ contractId: "SP1.amm", functionName: "swap-*" }),
		).toEqual({
			type: "contract_call",
			contractId: "SP1.amm",
			functionName: "swap-*",
		});
		expect(on.ftTransfer({ trait: "sip-010", minAmount: "1000000" })).toEqual({
			type: "ft_transfer",
			trait: "sip-010",
			minAmount: "1000000",
		});
		expect(on.stxTransfer()).toEqual({ type: "stx_transfer" });
	});
});

describe("Subscriptions.create with triggers", () => {
	test("POSTs a chain subscription body with triggers and no subgraph target", async () => {
		const bodies: unknown[] = [];
		globalThis.fetch = (async (input, init) => {
			const request =
				input instanceof Request ? input : new Request(input.toString(), init);
			bodies.push(await request.clone().json());
			return new Response(
				JSON.stringify({
					subscription: { id: "sub_1" },
					signingSecret: "whsec_x",
				}),
				{ status: 201, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const sl = new SecondLayer({ apiKey: "sk-test" });
		const res = await sl.subscriptions.create({
			name: "amm-swaps",
			url: "https://my.app/webhook",
			triggers: [on.contractCall({ contractId: "SP1.amm" })],
		});

		expect(res.signingSecret).toBe("whsec_x");
		expect(bodies[0]).toEqual({
			name: "amm-swaps",
			url: "https://my.app/webhook",
			triggers: [{ type: "contract_call", contractId: "SP1.amm" }],
		});
	});
});
