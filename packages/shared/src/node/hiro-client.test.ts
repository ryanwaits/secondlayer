import { afterEach, describe, expect, test } from "bun:test";
import { HiroClient } from "./hiro-client.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("HiroClient.getTransaction", () => {
	test("returns the tx_status for a known txid", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					tx_id: "0xabc",
					tx_status: "success",
					block_height: 100,
				}),
				{ status: 200 },
			)) as unknown as typeof fetch;
		const tx = await new HiroClient().getTransaction("0xabc");
		expect(tx).toMatchObject({ tx_id: "0xabc", tx_status: "success" });
	});

	test("returns null for an unknown (404) txid", async () => {
		globalThis.fetch = (async () =>
			new Response(null, { status: 404 })) as unknown as typeof fetch;
		expect(await new HiroClient().getTransaction("0xmissing")).toBeNull();
	});
});
