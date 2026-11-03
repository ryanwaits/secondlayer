import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { probe } from "../../skills/secondlayer/dash/template/probe.ts";
import { type Stub, closedUrl, startUpstream } from "./upstream.ts";

const ENV = [
	"SL_DASH_BASE_MAINNET",
	"SECONDLAYER_DEVNET_URL",
	"SECONDLAYER_API_KEY",
	"INSTANCE_TOKEN",
] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

let up: Stub;

beforeAll(() => {
	up = startUpstream();
	process.env.SL_DASH_BASE_MAINNET = up.url;
	process.env.SECONDLAYER_DEVNET_URL = closedUrl();
	process.env.SECONDLAYER_API_KEY = "sk-sl_test_key";
	delete process.env.INSTANCE_TOKEN;
});

afterAll(() => {
	up.stop();
	for (const k of ENV) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe("probe", () => {
	test("lists what each network holds and marks an unreachable devnet", async () => {
		const out = await probe();
		expect(out.networks.mainnet).toEqual({
			ok: true,
			webhooks: [
				{
					id: "wh_1",
					name: "sbtc-deposits",
					status: "active",
					triggers: [{ type: "contract_call" }],
				},
			],
			subgraphs: [
				{ name: "vault-flows", tables: { deposits: ["sender", "amount"] } },
			],
		});
		expect(out.networks.testnet).toMatchObject({ ok: true, subgraphs: [] });
		expect(out.networks.devnet).toMatchObject({ ok: false, webhooks: [] });
		expect(out.networks.devnet?.reason).toContain("not answering");
		expect(out.decision.webhooks).toEqual({
			networks: ["mainnet", "testnet"],
			tabs: true,
		});
		expect(out.decision.subgraphs).toEqual({
			networks: ["mainnet"],
			tabs: false,
		});
	});

	test("testnet is never asked for subgraphs", async () => {
		up.seen.length = 0;
		await probe(["testnet"]);
		expect(up.seen.map((s) => s.path)).toEqual([
			"/testnet/api/webhooks",
			"/testnet/api/webhooks/wh_1",
		]);
	});

	test("a named network limits the probe and the decision", async () => {
		const out = await probe(["mainnet"]);
		expect(Object.keys(out.networks)).toEqual(["mainnet"]);
		expect(out.decision.webhooks).toEqual({
			networks: ["mainnet"],
			tabs: false,
		});
	});
});
