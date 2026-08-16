import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import {
	creditCredits,
	getCredits,
} from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { Hono, type MiddlewareHandler } from "hono";
import { createApiApp } from "../create-app.ts";
import { errorHandler } from "../middleware/error.ts";
import {
	ARCHIVE_PARTITION_KEY_RE,
	type ArchiveRouterOptions,
	createArchiveRouter,
	deriveDatasetFromPath,
} from "./archive.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const db = HAS_DB ? getDb() : (null as never);

const FAKE_CONFIG = {
	endpoint: "https://fake.r2.example",
	accessKeyId: "test-access-key",
	secretAccessKey: "test-secret-key",
	bucket: "test-archive-bucket",
};

const PREFIX = "secondlayer/mainnet/canonical/v1";

function partitionPath(
	dataset: "blocks" | "transactions" | "events",
	from: number,
	to: number,
	suffix = "0000000000000000",
): string {
	return `${PREFIX}/${dataset}/${from}-${to}-${suffix}.parquet`;
}

const accountIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

afterEach(async () => {
	if (!HAS_DB) return;
	if (accountIds.length > 0) {
		await db
			.deleteFrom("archive_fetches")
			.where("account_id", "in", accountIds)
			.execute();
	}
});

afterAll(async () => {
	if (!HAS_DB) return;
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

/** Builds a minimal test app: a fake-accountId middleware in front of the
 * router under test, plus the real error handler (so `InvalidJSONError` etc.
 * map the same way they do in the mounted app). Never touches real R2 —
 * `getConfig`/`presign` are injected per the router's option seam. */
function buildTestApp(params: {
	accountId?: string;
	options?: ArchiveRouterOptions;
	presignCalls?: string[];
}): Hono {
	const app = new Hono();
	const setAccountId: MiddlewareHandler = async (c, next) => {
		if (params.accountId) c.set("accountId", params.accountId);
		await next();
	};
	app.use("*", setAccountId);
	app.onError(errorHandler);
	const router = createArchiveRouter({
		getConfig: () => FAKE_CONFIG,
		presign: async ({ key }) => {
			params.presignCalls?.push(key);
			return `https://fake.r2.example/${key}?sig=test`;
		},
		now: () => new Date("2026-08-16T12:00:00.000Z"),
		...params.options,
	});
	app.route("/", router);
	return app;
}

async function postJson(
	app: Hono,
	path: string,
	body: unknown,
): Promise<Response> {
	return await app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe.skipIf(!HAS_DB)(
	"deriveDatasetFromPath / ARCHIVE_PARTITION_KEY_RE",
	() => {
		test("accepts a well-formed partition key for each dataset", () => {
			expect(deriveDatasetFromPath(partitionPath("blocks", 0, 50_000))).toBe(
				"blocks",
			);
			expect(
				deriveDatasetFromPath(partitionPath("transactions", 0, 50_000)),
			).toBe("transactions");
			expect(deriveDatasetFromPath(partitionPath("events", 0, 50_000))).toBe(
				"events",
			);
		});

		test("rejects a key missing the archive prefix", () => {
			expect(
				deriveDatasetFromPath("blocks/0-50000-0000000000000000.parquet"),
			).toBeNull();
		});

		test("rejects a key with an unrecognized dataset segment", () => {
			expect(
				deriveDatasetFromPath(
					`${PREFIX}/mempool/0-50000-0000000000000000.parquet`,
				),
			).toBeNull();
		});

		test("rejects a client-claimed cheap dataset for a malformed suffix", () => {
			// Right dataset name, wrong shape (no hash suffix) — must not pass.
			expect(
				deriveDatasetFromPath(`${PREFIX}/blocks/0-50000.parquet`),
			).toBeNull();
		});

		test("regex is anchored (no partial match)", () => {
			expect(
				ARCHIVE_PARTITION_KEY_RE.test(
					"blocks/0-50000-0000000000000000.parquet",
				),
			).toBe(true);
			expect(
				ARCHIVE_PARTITION_KEY_RE.test(
					"nested/blocks/0-50000-0000000000000000.parquet",
				),
			).toBe(false);
		});
	},
);

describe.skipIf(!HAS_DB)("POST /quote", () => {
	test("prices a mixed batch correctly", async () => {
		const accountId = await makeAccount();
		await creditCredits(db, accountId, 10_000_000n);
		const app = buildTestApp({ accountId });

		const res = await postJson(app, "/quote", {
			flow: "bootstrap",
			paths: [
				partitionPath("blocks", 0, 50_000, "0000000000000001"),
				partitionPath("blocks", 50_000, 100_000, "0000000000000002"),
				partitionPath("transactions", 0, 50_000, "0000000000000003"),
				partitionPath("transactions", 50_000, 100_000, "0000000000000004"),
				partitionPath("events", 0, 50_000, "0000000000000005"),
				partitionPath("events", 50_000, 100_000, "0000000000000006"),
			],
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			partitions: number;
			usd_micros: number;
			usd: string;
			sufficient: boolean;
		};
		expect(body.partitions).toBe(6);
		expect(body.usd_micros).toBe(500_000);
		expect(body.usd).toBe("0.50");
		expect(body.sufficient).toBe(true);
	});

	test("malformed path → 400", async () => {
		const accountId = await makeAccount();
		const app = buildTestApp({ accountId });

		const res = await postJson(app, "/quote", {
			flow: "bootstrap",
			paths: ["not/a/real/archive/key.parquet"],
		});
		expect(res.status).toBe(400);
	});
});

describe.skipIf(!HAS_DB)("POST /fetch", () => {
	test("debits and returns URLs; balance decreases by exactly the quote", async () => {
		const accountId = await makeAccount();
		await creditCredits(db, accountId, 10_000_000n);
		const presignCalls: string[] = [];
		const app = buildTestApp({ accountId, presignCalls });

		const paths = [
			partitionPath("blocks", 0, 50_000, "1000000000000001"),
			partitionPath("events", 0, 50_000, "1000000000000002"),
		];
		const res = await postJson(app, "/fetch", { flow: "bootstrap", paths });

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			urls: Array<{ path: string; url: string; charged_usd_micros: number }>;
			charged_total_usd_micros: number;
			balance_after_usd_micros: number;
		};
		expect(body.urls).toHaveLength(2);
		expect(body.charged_total_usd_micros).toBe(50_000 + 150_000);
		expect(body.balance_after_usd_micros).toBe(10_000_000 - 200_000);
		expect(presignCalls).toEqual(paths);

		const balance = await getCredits(db, accountId);
		expect(balance).toBe(9_800_000n);
	});

	test("a duplicate path within one batch is charged once, not twice", async () => {
		const accountId = await makeAccount();
		await creditCredits(db, accountId, 10_000_000n);
		const app = buildTestApp({ accountId });

		const path = partitionPath("blocks", 0, 50_000, "1500000000000001");
		const res = await postJson(app, "/fetch", {
			flow: "bootstrap",
			paths: [path, path],
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			urls: Array<{ path: string; charged_usd_micros: number }>;
			charged_total_usd_micros: number;
		};
		expect(body.urls).toHaveLength(1);
		expect(body.charged_total_usd_micros).toBe(50_000);

		const rows = await db
			.selectFrom("archive_fetches")
			.select("id")
			.where("account_id", "=", accountId)
			.where("path", "=", path)
			.execute();
		expect(rows).toHaveLength(1);
		expect(await getCredits(db, accountId)).toBe(10_000_000n - 50_000n);
	});

	test("insufficient balance → 402, zero archive_fetches rows, balance unchanged", async () => {
		const accountId = await makeAccount();
		// No credits given — balance is 0.
		const app = buildTestApp({ accountId });

		const paths = [partitionPath("blocks", 0, 50_000, "2000000000000001")];
		const res = await postJson(app, "/fetch", { flow: "bootstrap", paths });

		expect(res.status).toBe(402);
		const body = (await res.json()) as { shortfall_usd_micros: number };
		expect(body.shortfall_usd_micros).toBe(50_000);

		const rows = await db
			.selectFrom("archive_fetches")
			.select("id")
			.where("account_id", "=", accountId)
			.execute();
		expect(rows).toHaveLength(0);
		expect(await getCredits(db, accountId)).toBe(0n);
	});

	test("re-fetch of a charged path within 24h re-presigns for free", async () => {
		const accountId = await makeAccount();
		await creditCredits(db, accountId, 10_000_000n);
		const t0 = new Date("2026-08-16T12:00:00.000Z");
		// An hour later — still inside the 24h window, but a distinct
		// `charged_at` so the second (free) log row doesn't collide with the
		// first on the (account_id, path, charged_at) unique constraint, same
		// as two real requests always land at different instants.
		const t1 = new Date("2026-08-16T13:00:00.000Z");
		const appAtT0 = buildTestApp({ accountId, options: { now: () => t0 } });
		const appAtT1 = buildTestApp({ accountId, options: { now: () => t1 } });

		const path = partitionPath("blocks", 0, 50_000, "3000000000000001");

		const first = await postJson(appAtT0, "/fetch", {
			flow: "bootstrap",
			paths: [path],
		});
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as {
			urls: Array<{ charged_usd_micros: number }>;
		};
		expect(firstBody.urls[0]?.charged_usd_micros).toBe(50_000);

		const second = await postJson(appAtT1, "/fetch", {
			flow: "bootstrap",
			paths: [path],
		});
		expect(second.status).toBe(200);
		const secondBody = (await second.json()) as {
			urls: Array<{ path: string; url: string; charged_usd_micros: number }>;
		};
		expect(secondBody.urls[0]?.charged_usd_micros).toBe(0);
		expect(secondBody.urls[0]?.url).toBeTruthy();

		// Only the first fetch actually debited.
		expect(await getCredits(db, accountId)).toBe(10_000_000n - 50_000n);
	});

	test("repair flow: allowance covers up to 18 partitions/month, the 19th is charged", async () => {
		const accountId = await makeAccount();
		await creditCredits(db, accountId, 10_000_000n);
		const now = new Date("2026-08-16T12:00:00.000Z");

		// Seed 17 already-allowance-used partitions this calendar month.
		const { recordFetch } = await import(
			"@secondlayer/platform/db/queries/archive-fetches"
		);
		for (let i = 0; i < 17; i++) {
			await recordFetch(
				db,
				{
					accountId,
					path: partitionPath(
						"blocks",
						i * 50_000,
						(i + 1) * 50_000,
						"4000000000000000",
					),
					dataset: "blocks",
					usdMicros: 0n,
					viaAllowance: true,
				},
				now,
			);
		}

		const app = buildTestApp({ accountId });
		const eighteenth = partitionPath(
			"events",
			900_000,
			950_000,
			"4000000000000018",
		);
		const nineteenth = partitionPath(
			"events",
			950_000,
			1_000_000,
			"4000000000000019",
		);

		const res = await postJson(app, "/fetch", {
			flow: "repair",
			paths: [eighteenth, nineteenth],
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			urls: Array<{ path: string; charged_usd_micros: number }>;
		};
		const byPath = new Map(
			body.urls.map((u) => [u.path, u.charged_usd_micros]),
		);
		expect(byPath.get(eighteenth)).toBe(0);
		expect(byPath.get(nineteenth)).toBe(150_000);

		const rows = await db
			.selectFrom("archive_fetches")
			.select(["path", "via_allowance", "usd_micros"])
			.where("account_id", "=", accountId)
			.where("path", "in", [eighteenth, nineteenth])
			.execute();
		const rowByPath = new Map(rows.map((r) => [r.path, r]));
		expect(rowByPath.get(eighteenth)?.via_allowance).toBe(true);
		expect(Number(rowByPath.get(eighteenth)?.usd_micros)).toBe(0);
		expect(rowByPath.get(nineteenth)?.via_allowance).toBe(false);
		expect(Number(rowByPath.get(nineteenth)?.usd_micros)).toBe(150_000);
	});

	test("batch of 65 paths → 413", async () => {
		const accountId = await makeAccount();
		const app = buildTestApp({ accountId });
		const paths = Array.from({ length: 65 }, (_, i) =>
			partitionPath(
				"blocks",
				i * 50_000,
				(i + 1) * 50_000,
				i.toString(16).padStart(16, "0"),
			),
		);
		const res = await postJson(app, "/fetch", { flow: "bootstrap", paths });
		expect(res.status).toBe(413);
	});
});

describe.skipIf(!HAS_DB)("unauthenticated + unconfigured", () => {
	let prevDevMode: string | undefined;

	beforeAll(() => {
		prevDevMode = process.env.DEV_MODE;
		// DEV_MODE bypasses auth entirely — this test exercises the real
		// requireAuth() 401 path via the PLATFORM_PATHS middleware.
		process.env.DEV_MODE = "false";
	});

	afterAll(() => {
		if (prevDevMode === undefined) delete process.env.DEV_MODE;
		else process.env.DEV_MODE = prevDevMode;
	});

	test("unauthenticated request 401s from PLATFORM_PATHS middleware, not the route", async () => {
		const app = createApiApp("platform");
		const res = await app.request("/api/archive/quote", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				flow: "bootstrap",
				paths: [partitionPath("blocks", 0, 50_000)],
			}),
		});
		expect(res.status).toBe(401);
	});

	test("router 503s (does not crash) when R2 env is unset", async () => {
		const accountId = "00000000-0000-0000-0000-000000000000";
		const app = buildTestApp({
			accountId,
			options: { getConfig: () => null },
		});

		const quoteRes = await postJson(app, "/quote", {
			flow: "bootstrap",
			paths: [partitionPath("blocks", 0, 50_000)],
		});
		expect(quoteRes.status).toBe(503);

		const fetchRes = await postJson(app, "/fetch", {
			flow: "bootstrap",
			paths: [partitionPath("blocks", 0, 50_000)],
		});
		expect(fetchRes.status).toBe(503);
	});
});
