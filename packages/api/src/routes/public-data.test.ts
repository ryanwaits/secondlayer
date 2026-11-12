import { describe, expect, test } from "bun:test";
import {
	type PublicPoxData,
	type PublicRunesData,
	type PublicSbtcData,
	createMemoizedReader,
	createPublicDataRouter,
} from "./public-data.ts";

const TIP = { block_height: 9_469_882, lag_seconds: 3 };

const SBTC: PublicSbtcData = {
	summary: {
		total_deposits: 69_849,
		total_withdrawals_requested: 10,
		total_withdrawals_accepted: 9,
		total_withdrawals_rejected: 1,
		net_peg_flow_sats: "248003000000",
		total_locked_sats: "248003000000",
		unmatched_withdrawal_accepts: 0,
		sbtc_supply_sats: "248003000000",
	},
	tip: TIP,
	generated_at: "2026-11-12T12:00:00.000Z",
};

const POX = {
	current: { reward_cycle: 147, is_current: true },
	next: { reward_cycle: 148, is_current: false },
	signers: [{ signer: "SP1.a", delegated_ustx: "5", in_set: true }],
	tip: TIP,
	generated_at: "2026-11-12T12:00:00.000Z",
} as unknown as PublicPoxData;

const RUNES: PublicRunesData = {
	most_minted: [
		{
			id: "1:0",
			spaced_name: "UNCOMMON•GOODS",
			symbol: "⧉",
			mints: "173834708",
			supply: "173834708",
			divisibility: 0,
		},
	],
	tip: { block_height: 975_573 },
	generated_at: "2026-11-12T12:00:00.000Z",
};

function counter<T>(value: T) {
	let calls = 0;
	return {
		read: async () => {
			calls++;
			return value;
		},
		calls: () => calls,
	};
}

describe("/public/data routes", () => {
	test("serve the sbtc scoreboard without a key, cached for a minute", async () => {
		const sbtc = counter(SBTC);
		const app = createPublicDataRouter({ readSbtc: sbtc.read });
		const res = await app.request("/public/data/sbtc");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(
			"public, max-age=60, s-maxage=60",
		);
		const body = (await res.json()) as PublicSbtcData;
		expect(body.summary.sbtc_supply_sats).toBe("248003000000");
		expect(body.tip.block_height).toBe(9_469_882);
	});

	test("serve current cycle, next cycle and signers for pox", async () => {
		const pox = counter(POX);
		const app = createPublicDataRouter({ readPox: pox.read });
		const res = await app.request("/public/data/pox");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(
			"public, max-age=60, s-maxage=60",
		);
		const body = (await res.json()) as PublicPoxData;
		expect(body.current?.reward_cycle).toBe(147);
		expect(body.next?.reward_cycle).toBe(148);
		expect(body.signers).toHaveLength(1);
	});

	test("serve the most-minted runes with the bitcoin tip, no key", async () => {
		const runes = counter(RUNES);
		const app = createPublicDataRouter({ readRunes: runes.read });
		const res = await app.request("/public/data/runes");
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe(
			"public, max-age=60, s-maxage=60",
		);
		const body = (await res.json()) as PublicRunesData;
		expect(body.most_minted[0]?.spaced_name).toBe("UNCOMMON•GOODS");
		expect(body.tip.block_height).toBe(975_573);
	});

	test("read the database once for requests within the TTL", async () => {
		const sbtc = counter(SBTC);
		const pox = counter(POX);
		const runes = counter(RUNES);
		let at = 0;
		const app = createPublicDataRouter({
			readSbtc: sbtc.read,
			readPox: pox.read,
			readRunes: runes.read,
			now: () => at,
		});
		await app.request("/public/data/sbtc");
		await app.request("/public/data/sbtc");
		await app.request("/public/data/pox");
		await app.request("/public/data/pox");
		await app.request("/public/data/runes");
		await app.request("/public/data/runes");
		expect(sbtc.calls()).toBe(1);
		expect(pox.calls()).toBe(1);
		expect(runes.calls()).toBe(1);
		at = 60_000;
		await app.request("/public/data/sbtc");
		expect(sbtc.calls()).toBe(2);
	});

	test("answer 503 uncached when the read fails, then recover", async () => {
		let fail = true;
		const app = createPublicDataRouter({
			readSbtc: async () => {
				if (fail) throw new Error("db down");
				return SBTC;
			},
		});
		const down = await app.request("/public/data/sbtc");
		expect(down.status).toBe(503);
		expect(down.headers.get("cache-control")).toBe("no-store");
		fail = false;
		const up = await app.request("/public/data/sbtc");
		expect(up.status).toBe(200);
	});

	test("answer 503 uncached when the runes read fails", async () => {
		const app = createPublicDataRouter({
			readRunes: async () => {
				throw new Error("bitcoin db down");
			},
		});
		const res = await app.request("/public/data/runes");
		expect(res.status).toBe(503);
		expect(res.headers.get("cache-control")).toBe("no-store");
	});
});

describe("createMemoizedReader", () => {
	test("concurrent callers share one in-flight read", async () => {
		let calls = 0;
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const read = createMemoizedReader(async () => {
			calls++;
			await gate;
			return "x";
		});
		const all = Promise.all([read(), read(), read()]);
		release();
		expect(await all).toEqual(["x", "x", "x"]);
		expect(calls).toBe(1);
	});
});
