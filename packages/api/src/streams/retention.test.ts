import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import type { StreamsEnv } from "./auth.ts";
import { streamsRetentionWindow } from "./retention.ts";
import { STREAMS_BLOCKS_PER_DAY } from "./tiers.ts";
import type { StreamsTip } from "./tip.ts";

const TIP: StreamsTip = {
	block_height: 1_000_000,
	block_hash: "0x01",
	burn_block_height: 999_000,
	finalized_height: 999_994,
	lag_seconds: 0,
};
// Free retention = 1 day, so anything older than tip - 17,280 is gated.
const DEEP = TIP.block_height - STREAMS_BLOCKS_PER_DAY - 1;

/** Free-tier streams tenant; `credited` optionally pre-set. */
function app(seed?: { credited?: boolean }) {
	const a = new Hono<StreamsEnv>();
	a.onError(errorHandler);
	a.use("*", async (c, next) => {
		c.set("streamsTenant", {
			tenant_id: "t",
			account_id: "acct",
			tier: "free",
			scopes: [],
		});
		if (seed?.credited)
			c.set("credited", { accountId: "acct", balance: 10_000n });
		await next();
	});
	a.use("/events", streamsRetentionWindow({ getTip: () => TIP }));
	a.get("/events", (c) => c.json({ ok: true }));
	return a;
}

describe("streamsRetentionWindow + credits bypass", () => {
	test("free: recent read inside the 1-day window passes", async () => {
		const res = await app().request("/events");
		expect(res.status).toBe(200);
	});

	test("free: deep from_height past retention → 403 RETENTION", async () => {
		const res = await app().request(`/events?from_height=${DEEP}`);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { details?: { reason?: string } };
		expect(body.details?.reason).toBe("RETENTION");
	});

	test("credited free account: deep read passes (pay-as-you-go)", async () => {
		const res = await app({ credited: true }).request(
			`/events?from_height=${DEEP}`,
		);
		expect(res.status).toBe(200);
	});
});
