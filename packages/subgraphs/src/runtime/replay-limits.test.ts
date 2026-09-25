import { afterEach, describe, expect, it } from "bun:test";
import { replayWebhook } from "./replay.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

/**
 * The block-range ceiling check runs before any DB lookup, so it's testable
 * without a real webhook fixture — including the `WEBHOOK_REPLAY_MAX_BLOCKS`
 * override, which the default-100k route test (`packages/api/test/webhooks.
 * test.ts`) can't exercise without mutating shared process env.
 */
describe("replayWebhook block-range ceiling", () => {
	afterEach(() => {
		Reflect.deleteProperty(process.env, "WEBHOOK_REPLAY_MAX_BLOCKS");
	});

	it("rejects a range over the default 100k-block ceiling", async () => {
		await expect(
			replayWebhook({
				accountId: "x",
				webhookId: "y",
				fromBlock: 0,
				toBlock: 200_000,
			}),
		).rejects.toThrow("replay range exceeds 100k blocks");
	});

	it("respects a lower WEBHOOK_REPLAY_MAX_BLOCKS override, message in raw blocks", async () => {
		process.env.WEBHOOK_REPLAY_MAX_BLOCKS = "500";
		await expect(
			replayWebhook({
				accountId: "x",
				webhookId: "y",
				fromBlock: 0,
				toBlock: 1000,
			}),
		).rejects.toThrow("replay range exceeds 500 blocks");
	});

	it("accepts a round-thousand override with the 'Nk' message form", async () => {
		process.env.WEBHOOK_REPLAY_MAX_BLOCKS = "2000";
		await expect(
			replayWebhook({
				accountId: "x",
				webhookId: "y",
				fromBlock: 0,
				toBlock: 5000,
			}),
		).rejects.toThrow("replay range exceeds 2k blocks");
	});
});
