import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import {
	type ReadBurnchainRewardsParams,
	getBurnchainRewardSlotsResponse,
	getBurnchainRewardsResponse,
} from "./query.ts";

const TIP = { burn_block_height: 951_500 };

function capture() {
	let seen: ReadBurnchainRewardsParams | undefined;
	const reader = async (params: ReadBurnchainRewardsParams) => {
		seen = params;
		return { rewards: [], next_cursor: null };
	};
	return {
		reader,
		get seen() {
			return seen;
		},
	};
}

describe("getBurnchainRewardsResponse", () => {
	test("defaults to full indexed range (fromBlock 0) and limit 200", async () => {
		const c = capture();
		await getBurnchainRewardsResponse({
			query: new URLSearchParams(),
			tip: TIP,
			readRewards: c.reader,
		});
		expect(c.seen?.fromBlock).toBe(0);
		expect(c.seen?.toBlock).toBe(951_500);
		expect(c.seen?.limit).toBe(200);
		expect(c.seen?.recipient).toBeUndefined();
	});

	test("passes recipient filter and clamps to_block to tip", async () => {
		const c = capture();
		await getBurnchainRewardsResponse({
			query: new URLSearchParams({ recipient: "bc1qx", to_block: "9999999" }),
			tip: TIP,
			readRewards: c.reader,
		});
		expect(c.seen?.recipient).toBe("bc1qx");
		expect(c.seen?.toBlock).toBe(951_500);
	});

	test("parses cursor as <burn_block_height>:<reward_index>", async () => {
		const c = capture();
		await getBurnchainRewardsResponse({
			query: new URLSearchParams({ cursor: "951400:1" }),
			tip: TIP,
			readRewards: c.reader,
		});
		expect(c.seen?.after).toEqual({ burn_block_height: 951_400, index: 1 });
		expect(c.seen?.fromBlock).toBe(951_400);
	});

	test("rejects cursor + from_block combo", async () => {
		await expect(
			getBurnchainRewardsResponse({
				query: new URLSearchParams({ cursor: "951400:0", from_block: "1" }),
				tip: TIP,
				readRewards: capture().reader,
			}),
		).rejects.toThrow(ValidationError);
	});

	test("rejects malformed cursor", async () => {
		await expect(
			getBurnchainRewardsResponse({
				query: new URLSearchParams({ cursor: "nope" }),
				tip: TIP,
				readRewards: capture().reader,
			}),
		).rejects.toThrow(ValidationError);
	});

	test("formats next_cursor and echoes tip", async () => {
		const response = await getBurnchainRewardsResponse({
			query: new URLSearchParams(),
			tip: TIP,
			readRewards: async () => ({
				rewards: [
					{
						cursor: "951400:0",
						burn_block_height: 951_400,
						burn_block_hash: "0xabc",
						reward_index: 0,
						recipient_btc: "bc1qx",
						amount_sats: "65000",
						burn_amount: "0",
					},
				],
				next_cursor: "951400:0",
			}),
		});
		expect(response.next_cursor).toBe("951400:0");
		expect(response.tip).toEqual(TIP);
		expect(response.rewards[0]?.recipient_btc).toBe("bc1qx");
	});
});

describe("getBurnchainRewardSlotsResponse", () => {
	test("passes holder filter", async () => {
		let holder: string | undefined;
		await getBurnchainRewardSlotsResponse({
			query: new URLSearchParams({ holder: "bc1qh" }),
			tip: TIP,
			readSlots: async (params) => {
				holder = params.holder;
				return { slots: [], next_cursor: null };
			},
		});
		expect(holder).toBe("bc1qh");
	});
});
