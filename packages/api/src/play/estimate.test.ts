import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import {
	PLAY_GRANT_USD_MICROS,
	RUNNING_USD_MICROS_PER_DAY,
	storageDailyCost,
} from "@secondlayer/platform/hosted-meters";
import { getDb } from "@secondlayer/shared/db";
import { hashToken } from "../auth/keys.ts";
import { createApiApp } from "../create-app.ts";
import { openapiSpec } from "../routes/openapi.ts";
import { STREAMS_BLOCKS_PER_DAY } from "../streams/tiers.ts";
import { buildPlayEstimate, formatUsd } from "./estimate.ts";
import { consumeClaimToken, createClaimToken } from "./tokens.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const seededAccountIds: string[] = [];
const seededNames: string[] = [];

function restoreEnv(key: string, prev: string | undefined): void {
	if (prev === undefined) Reflect.deleteProperty(process.env, key);
	else process.env[key] = prev;
}

function line(estimate: ReturnType<typeof buildPlayEstimate>, meter: string) {
	return estimate.lines.find((l) => l.meter === meter);
}

describe("buildPlayEstimate", () => {
	test("paused running is 0; active and reindexing are $3/mo", () => {
		const paused = buildPlayEstimate({
			grantMicros: PLAY_GRANT_USD_MICROS,
			remainingMicros: PLAY_GRANT_USD_MICROS,
			subgraphStatus: "paused",
			storageBytes: 0n,
			liveBlocksPerDay: 0,
			deliveriesLast24h: 0,
		});
		expect(line(paused, "running")?.usd_micros).toBe(0n);

		const active = buildPlayEstimate({
			grantMicros: PLAY_GRANT_USD_MICROS,
			remainingMicros: PLAY_GRANT_USD_MICROS,
			subgraphStatus: "active",
			storageBytes: 0n,
			liveBlocksPerDay: 0,
			deliveriesLast24h: 0,
		});
		expect(line(active, "running")?.usd_micros).toBe(
			RUNNING_USD_MICROS_PER_DAY * 30n,
		);

		const reindexing = buildPlayEstimate({
			grantMicros: PLAY_GRANT_USD_MICROS,
			remainingMicros: PLAY_GRANT_USD_MICROS,
			subgraphStatus: "reindexing",
			storageBytes: 0n,
			liveBlocksPerDay: 0,
			deliveriesLast24h: 0,
		});
		expect(line(reindexing, "running")?.usd_micros).toBe(
			RUNNING_USD_MICROS_PER_DAY * 30n,
		);
	});

	test("1 GB storage monthly is storageDailyCost * 30", () => {
		const estimate = buildPlayEstimate({
			grantMicros: PLAY_GRANT_USD_MICROS,
			remainingMicros: PLAY_GRANT_USD_MICROS,
			subgraphStatus: "paused",
			storageBytes: 1_000_000_000n,
			liveBlocksPerDay: 0,
			deliveriesLast24h: 0,
		});
		expect(line(estimate, "storage")?.usd_micros).toBe(
			storageDailyCost(1_000_000_000n) * 30n,
		);
	});

	test("0 deliveries is 0", () => {
		const estimate = buildPlayEstimate({
			grantMicros: PLAY_GRANT_USD_MICROS,
			remainingMicros: PLAY_GRANT_USD_MICROS,
			subgraphStatus: "active",
			storageBytes: 0n,
			liveBlocksPerDay: STREAMS_BLOCKS_PER_DAY,
			deliveriesLast24h: 0,
		});
		expect(line(estimate, "deliveries")?.usd_micros).toBe(0n);
	});

	test("grant spent is one_shot and excluded from projected_monthly", () => {
		const spent = 1_880_000n;
		const estimate = buildPlayEstimate({
			grantMicros: PLAY_GRANT_USD_MICROS,
			remainingMicros: PLAY_GRANT_USD_MICROS - spent,
			subgraphStatus: "active",
			storageBytes: 0n,
			liveBlocksPerDay: STREAMS_BLOCKS_PER_DAY,
			deliveriesLast24h: 0,
		});
		const spentLine = line(estimate, "grant_spent");
		expect(spentLine?.usd_micros).toBe(spent);
		expect(spentLine?.one_shot).toBe(true);
		expect(estimate.grant_spent_usd_micros).toBe(spent);
		expect(estimate.projected_monthly_usd_micros).toBe(
			RUNNING_USD_MICROS_PER_DAY * 30n + BigInt(STREAMS_BLOCKS_PER_DAY) * 30n,
		);
		expect(estimate.projected_monthly_usd_micros).not.toBe(
			estimate.projected_monthly_usd_micros + spent,
		);
	});
});

describe("formatUsd", () => {
	test("formats micros as dollars with two decimals", () => {
		expect(formatUsd(0n)).toBe("0.00");
		expect(formatUsd(3_000_000n)).toBe("3.00");
		expect(formatUsd(518_400n)).toBe("0.52");
	});
});

describe("GET /v1/play/estimate OSS", () => {
	test("GET and POST 404 when unmounted", async () => {
		const prev = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "oss";
		try {
			const app = createApiApp("oss");
			for (const method of ["GET", "POST"] as const) {
				const res = await app.request("/v1/play/estimate", { method });
				expect(res.status).toBe(404);
				const body = (await res.json()) as { code: string };
				expect(body.code).toBe("NOT_FOUND");
			}
		} finally {
			restoreEnv("INSTANCE_MODE", prev);
		}
	});

	test("OSS OpenAPI does not document /v1/play/estimate", () => {
		const oss = openapiSpec("oss") as unknown as {
			paths: Record<string, unknown>;
		};
		const platform = openapiSpec("platform") as unknown as {
			paths: Record<string, unknown>;
		};
		expect(oss.paths["/v1/play/estimate"]).toBeUndefined();
		expect(platform.paths["/v1/play/estimate"]).toBeDefined();
	});
});

describe("GET /v1/play/estimate platform (no db)", () => {
	test("missing or empty X-Claim-Token is 400", async () => {
		const prev = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
		try {
			const app = createApiApp("platform");
			const missing = await app.request("/v1/play/estimate");
			expect(missing.status).toBe(400);
			const empty = await app.request("/v1/play/estimate", {
				headers: { "X-Claim-Token": "  " },
			});
			expect(empty.status).toBe(400);
		} finally {
			restoreEnv("INSTANCE_MODE", prev);
		}
	});
});

describe.skipIf(!HAS_DB)("GET /v1/play/estimate platform", () => {
	let prevMode: string | undefined;

	beforeEach(() => {
		prevMode = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "platform";
	});

	afterEach(() => {
		restoreEnv("INSTANCE_MODE", prevMode);
	});

	afterAll(async () => {
		if (!HAS_DB) return;
		if (seededNames.length > 0) {
			await db
				.deleteFrom("subgraphs")
				.where("name", "in", seededNames)
				.execute();
		}
		if (seededAccountIds.length > 0) {
			await db
				.deleteFrom("account_credits")
				.where("account_id", "in", seededAccountIds)
				.execute();
			await db
				.deleteFrom("subscriptions")
				.where("account_id", "in", seededAccountIds)
				.execute();
			await db
				.deleteFrom("api_keys")
				.where("account_id", "in", seededAccountIds)
				.execute();
			await db
				.deleteFrom("claim_tokens")
				.where("account_id", "in", seededAccountIds)
				.execute();
			await db
				.deleteFrom("accounts")
				.where("id", "in", seededAccountIds)
				.execute();
		}
	});

	async function seedGhost(opts?: {
		ghost?: boolean;
		status?: string;
		credit?: bigint;
	}): Promise<{ accountId: string; raw: string; name: string }> {
		const account = await db
			.insertInto("accounts")
			.values({
				email:
					opts?.ghost === false
						? `est-${crypto.randomUUID().slice(0, 8)}@test.invalid`
						: null,
				ghost: opts?.ghost ?? true,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		seededAccountIds.push(account.id);
		const name = `play-est-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		await db
			.insertInto("subgraphs")
			.values({
				name,
				status: opts?.status ?? "active",
				definition: {},
				schema_hash: "test",
				handler_path: "test",
				schema_name: `subgraph_play_est_${crypto.randomUUID().slice(0, 8)}`,
				account_id: account.id,
				last_processed_block: 0,
				database_url_enc: null,
				expires_at: new Date(Date.now() + 86_400_000),
			})
			.execute();
		if (opts?.credit !== undefined && opts.credit > 0n) {
			await creditCredits(db, account.id, opts.credit);
		}
		const claim = await createClaimToken(db, account.id);
		return { accountId: account.id, raw: claim.raw, name };
	}

	test("valid token 200, running line $3.00 if active", async () => {
		const seeded = await seedGhost({ credit: PLAY_GRANT_USD_MICROS });
		const app = createApiApp("platform");
		const res = await app.request("/v1/play/estimate", {
			headers: { "X-Claim-Token": seeded.raw },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			grant_remaining_usd: string;
			grant_spent_usd: string;
			projected_monthly_usd: string;
			lines: Array<{ meter: string; usd: string; one_shot: boolean }>;
		};
		expect(body.grant_remaining_usd).toBe("10.00");
		expect(body.grant_spent_usd).toBe("0.00");
		expect(body.projected_monthly_usd).toBe("3.52");
		expect(body.lines.find((l) => l.meter === "running")).toEqual({
			meter: "running",
			usd: "3.00",
			one_shot: false,
		});
		expect(body.lines.find((l) => l.meter === "grant_spent")?.one_shot).toBe(
			true,
		);
	});

	test("used or expired token is 400", async () => {
		const used = await seedGhost();
		await consumeClaimToken(db, hashToken(used.raw));
		const expired = await seedGhost();
		await db
			.updateTable("claim_tokens")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("account_id", "=", expired.accountId)
			.execute();

		const app = createApiApp("platform");
		expect(
			(
				await app.request("/v1/play/estimate", {
					headers: { "X-Claim-Token": used.raw },
				})
			).status,
		).toBe(400);
		expect(
			(
				await app.request("/v1/play/estimate", {
					headers: { "X-Claim-Token": expired.raw },
				})
			).status,
		).toBe(400);
	});

	test("second GET is still 200; token is not consumed", async () => {
		const seeded = await seedGhost({ credit: PLAY_GRANT_USD_MICROS });
		const app = createApiApp("platform");
		const first = await app.request("/v1/play/estimate", {
			headers: { "X-Claim-Token": seeded.raw },
		});
		const second = await app.request("/v1/play/estimate", {
			headers: { "X-Claim-Token": seeded.raw },
		});
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		const row = await db
			.selectFrom("claim_tokens")
			.select("used_at")
			.where("token_hash", "=", hashToken(seeded.raw))
			.executeTakeFirstOrThrow();
		expect(row.used_at).toBeNull();
	});

	test("ghost=false is 404", async () => {
		const seeded = await seedGhost({ ghost: false });
		const app = createApiApp("platform");
		const res = await app.request("/v1/play/estimate", {
			headers: { "X-Claim-Token": seeded.raw },
		});
		expect(res.status).toBe(404);
	});
});
