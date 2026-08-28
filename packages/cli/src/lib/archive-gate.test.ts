import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrder } from "../commands/bootstrap.ts";
import {
	type ArchiveGateDeps,
	type ArchiveQuote,
	OFFICIAL_ARCHIVE_HOST,
	confirmationRequiredPayload,
	createGatedFetcher,
	formatInsufficientMessage,
	formatQuoteValue,
	isOfficialArchive,
	quoteArchiveFetch,
	shouldPromptForGatedFetch,
} from "./archive-gate.ts";
import { ARCHIVE_LOGIN_COMMAND, CliHttpError } from "./http.ts";

/**
 * Pure-logic coverage for the CLI's archive gate client: the official-host
 * predicate (the billing boundary — reviewed hardest per the plan's
 * maintenance notes), the quote result mapping, the batch-paging math, and
 * expiry recovery. No database needed — `httpArchiveOps` is stubbed via the
 * same options-injection seam `createArchiveRouter` uses server-side.
 */

function stubDeps(
	impl: (path: string, opts?: unknown) => Promise<unknown>,
): ArchiveGateDeps & { calls: Array<{ path: string; opts?: unknown }> } {
	const calls: Array<{ path: string; opts?: unknown }> = [];
	return {
		calls,
		httpArchiveOps: (async (path: string, opts?: unknown) => {
			calls.push({ path, opts });
			return impl(path, opts);
		}) as ArchiveGateDeps["httpArchiveOps"],
	};
}

describe("isOfficialArchive — the billing boundary", () => {
	test("a local directory reference is always free", () => {
		expect(
			isOfficialArchive({ isRemote: false, origin: "/some/local/path.json" }),
		).toBe(false);
	});

	test("a mirror host is free, never gated", () => {
		expect(
			isOfficialArchive({
				isRemote: true,
				origin: "https://my-mirror.example.com/latest.json",
			}),
		).toBe(false);
	});

	test("localhost / a teammate's box is free", () => {
		expect(
			isOfficialArchive({
				isRemote: true,
				origin: "http://localhost:8080/latest.json",
			}),
		).toBe(false);
	});

	test("the official archive host is always gated", () => {
		expect(
			isOfficialArchive({
				isRemote: true,
				origin: `https://${OFFICIAL_ARCHIVE_HOST}/latest.json`,
			}),
		).toBe(true);
	});

	test("a malformed origin never throws — treated as ungated", () => {
		expect(isOfficialArchive({ isRemote: true, origin: "not a url" })).toBe(
			false,
		);
	});
});

describe("quoteArchiveFetch", () => {
	test("maps a successful quote response into typed camelCase fields", async () => {
		const deps = stubDeps(async () => ({
			partitions: 6,
			bundles: 2,
			usd_micros: 500_000,
			usd: "0.50",
			free_allowance_applied_micros: 0,
			allowance_remaining_bundles: 6,
			balance_usd_micros: 10_000_000,
			sufficient: true,
		}));

		const result = await quoteArchiveFetch(["a", "b"], "bootstrap", deps);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.quote).toEqual({
			partitions: 6,
			bundles: 2,
			usdMicros: 500_000,
			usd: "0.50",
			freeAllowanceAppliedMicros: 0,
			allowanceRemainingBundles: 6,
			balanceUsdMicros: 10_000_000,
			sufficient: true,
		});
		expect(deps.calls).toEqual([
			{
				path: "/api/archive/quote",
				opts: {
					method: "POST",
					body: { paths: ["a", "b"], flow: "bootstrap" },
				},
			},
		]);
	});

	test("503 (gate unconfigured) maps to a typed result, not a throw", async () => {
		const deps = stubDeps(async () => {
			throw new CliHttpError(
				503,
				"HTTP_503",
				{},
				"archive_gate_not_configured",
			);
		});
		const result = await quoteArchiveFetch(["a"], "bootstrap", deps);
		expect(result).toEqual({ ok: false, kind: "not_configured" });
	});

	test("401 (not logged in) maps to a typed result carrying the login hint", async () => {
		const deps = stubDeps(async () => {
			throw new CliHttpError(
				401,
				"SESSION_EXPIRED",
				{},
				"Not logged in — run `secondlayer login`",
			);
		});
		const result = await quoteArchiveFetch(["a"], "repair", deps);
		expect(result).toEqual({
			ok: false,
			kind: "not_authed",
			message: "Not logged in — run `secondlayer login`",
		});
	});

	test("a merchant 401 through the real HTTP seam tells the reader to run the credits login, so bootstrap exits refused with the fix on screen", async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () =>
				Response.json({ error: "Invalid token format" }, { status: 401 }),
		});
		const saved = {
			SL_CREDITS_API_URL: process.env.SL_CREDITS_API_URL,
			SL_API_KEY: process.env.SL_API_KEY,
			INSTANCE_TOKEN: process.env.INSTANCE_TOKEN,
			HOME: process.env.HOME,
		};
		// Isolated HOME so the developer's real session file never picks the bearer.
		const home = await mkdtemp(join(tmpdir(), "sl-archive-gate-"));
		process.env.HOME = home;
		process.env.SL_CREDITS_API_URL = `http://127.0.0.1:${server.port}`;
		process.env.SL_API_KEY = "sk-sl_stale";
		Reflect.deleteProperty(process.env, "INSTANCE_TOKEN");
		try {
			const result = await quoteArchiveFetch(["a"], "bootstrap");
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.kind).toBe("not_authed");
			if (result.kind !== "not_authed") return;
			expect(result.message).toContain(ARCHIVE_LOGIN_COMMAND);
		} finally {
			server.stop(true);
			await rm(home, { recursive: true, force: true });
			for (const [k, v] of Object.entries(saved)) {
				if (v === undefined) Reflect.deleteProperty(process.env, k);
				else process.env[k] = v;
			}
		}
	});

	test("any other HTTP error maps to a generic typed error", async () => {
		const deps = stubDeps(async () => {
			throw new CliHttpError(400, "HTTP_400", {}, "malformed archive path(s)");
		});
		const result = await quoteArchiveFetch(["a"], "bootstrap", deps);
		expect(result).toEqual({
			ok: false,
			kind: "error",
			message: "malformed archive path(s)",
		});
	});

	test("a non-CliHttpError throw is not swallowed", async () => {
		const deps = stubDeps(async () => {
			throw new Error("network is down");
		});
		expect(quoteArchiveFetch(["a"], "bootstrap", deps)).rejects.toThrow(
			"network is down",
		);
	});
});

describe("createGatedFetcher — batch paging", () => {
	test("a batch of 16 or fewer paths triggers exactly one /fetch call", async () => {
		const paths = Array.from({ length: 16 }, (_, i) => `blocks/${i}.parquet`);
		const deps = stubDeps(async (_p, opts) => ({
			urls: (opts as { body: { paths: string[] } }).body.paths.map((path) => ({
				path,
				url: `https://fake.r2.example/${path}?sig=x`,
				expires_at: new Date(Date.now() + 900_000).toISOString(),
				charged_usd_micros: 50_000,
			})),
			charged_total_usd_micros: 800_000,
			balance_after_usd_micros: 9_200_000,
		}));
		const fetcher = createGatedFetcher(paths, "bootstrap", deps);

		const first = await fetcher.getUrl(paths[0] as string);
		const second = await fetcher.getUrl(paths[15] as string);

		expect(first).toBe(`https://fake.r2.example/${paths[0]}?sig=x`);
		expect(second).toBe(`https://fake.r2.example/${paths[15]}?sig=x`);
		expect(deps.calls).toHaveLength(1);
	});

	test("a 17th path is in a second batch, fetched lazily on its own /fetch call", async () => {
		const paths = Array.from({ length: 17 }, (_, i) => `blocks/${i}.parquet`);
		const deps = stubDeps(async (_p, opts) => ({
			urls: (opts as { body: { paths: string[] } }).body.paths.map((path) => ({
				path,
				url: `https://fake.r2.example/${path}?sig=x`,
				expires_at: new Date(Date.now() + 900_000).toISOString(),
				charged_usd_micros: 50_000,
			})),
			charged_total_usd_micros: 0,
			balance_after_usd_micros: 0,
		}));
		const fetcher = createGatedFetcher(paths, "bootstrap", deps);

		await fetcher.getUrl(paths[0] as string);
		expect(deps.calls).toHaveLength(1);
		expect(
			(deps.calls[0]?.opts as { body: { paths: string[] } }).body.paths,
		).toHaveLength(16);

		await fetcher.getUrl(paths[16] as string);
		expect(deps.calls).toHaveLength(2);
		expect(
			(deps.calls[1]?.opts as { body: { paths: string[] } }).body.paths,
		).toEqual([paths[16]]);
	});

	test("concurrent getUrl calls within the same un-fetched batch collapse to one /fetch call", async () => {
		const paths = Array.from({ length: 4 }, (_, i) => `blocks/${i}.parquet`);
		const deps = stubDeps(async (_p, opts) => ({
			urls: (opts as { body: { paths: string[] } }).body.paths.map((path) => ({
				path,
				url: `https://fake.r2.example/${path}?sig=x`,
				expires_at: new Date(Date.now() + 900_000).toISOString(),
				charged_usd_micros: 50_000,
			})),
			charged_total_usd_micros: 0,
			balance_after_usd_micros: 0,
		}));
		const fetcher = createGatedFetcher(paths, "bootstrap", deps);

		const results = await Promise.all(paths.map((p) => fetcher.getUrl(p)));
		expect(results).toEqual(
			paths.map((p) => `https://fake.r2.example/${p}?sig=x`),
		);
		expect(deps.calls).toHaveLength(1);
	});

	test("forceRefresh bypasses the cache and re-issues a single-path fetch, free within the 24h window", async () => {
		const paths = ["blocks/0.parquet"];
		let callCount = 0;
		const deps = stubDeps(async (_p, opts) => {
			callCount++;
			const requested = (opts as { body: { paths: string[] } }).body.paths;
			return {
				urls: requested.map((path) => ({
					path,
					url: `https://fake.r2.example/${path}?sig=${callCount}`,
					expires_at: new Date(Date.now() + 900_000).toISOString(),
					charged_usd_micros: 0,
				})),
				charged_total_usd_micros: 0,
				balance_after_usd_micros: 0,
			};
		});
		const fetcher = createGatedFetcher(paths, "bootstrap", deps);

		const original = await fetcher.getUrl("blocks/0.parquet");
		const refreshed = await fetcher.getUrl("blocks/0.parquet", {
			forceRefresh: true,
		});

		expect(original).toBe("https://fake.r2.example/blocks/0.parquet?sig=1");
		expect(refreshed).toBe("https://fake.r2.example/blocks/0.parquet?sig=2");
		expect(refreshed).not.toBe(original);
		expect(deps.calls).toHaveLength(2);
		expect(
			(deps.calls[1]?.opts as { body: { paths: string[] } }).body.paths,
		).toEqual(["blocks/0.parquet"]);
	});

	test("a cached URL with under a minute to live is re-issued before it is handed out", async () => {
		const paths = ["blocks/0.parquet", "blocks/1.parquet"];
		let clock = 1_000_000;
		let callCount = 0;
		const deps = stubDeps(async (_p, opts) => {
			callCount++;
			const requested = (opts as { body: { paths: string[] } }).body.paths;
			return {
				urls: requested.map((path) => ({
					path,
					// Every issue lasts 900s from the moment the stub answers.
					url: `https://fake.r2.example/${path}?sig=${callCount}`,
					expires_at: new Date(clock + 900_000).toISOString(),
					charged_usd_micros: 0,
				})),
				charged_total_usd_micros: 0,
				balance_after_usd_micros: 0,
			};
		});
		const fetcher = createGatedFetcher(paths, "bootstrap", deps, () => clock);

		const first = await fetcher.getUrl("blocks/0.parquet");
		expect(first).toBe("https://fake.r2.example/blocks/0.parquet?sig=1");
		expect(deps.calls).toHaveLength(1);

		// 30s left on the batch's URLs: too little for a slow COPY.
		clock += 870_000;
		const refreshed = await fetcher.getUrl("blocks/1.parquet");
		expect(refreshed).toBe("https://fake.r2.example/blocks/1.parquet?sig=2");
		expect(deps.calls).toHaveLength(2);
		expect(
			(deps.calls[1]?.opts as { body: { paths: string[] } }).body.paths,
		).toEqual(["blocks/1.parquet"]);

		// The re-issued URL is fresh, so the next call serves it from cache.
		expect(await fetcher.getUrl("blocks/1.parquet")).toBe(refreshed);
		expect(deps.calls).toHaveLength(2);
	});

	test("the first batch charged for a bootstrap holds only blocks paths when paths arrive in load order", async () => {
		// 20 of each dataset, interleaved the way a manifest lists them; the
		// batch size is 16 so an unordered list would mix datasets.
		const manifestOrder = Array.from({ length: 20 }, (_, i) => i).flatMap(
			(i) => [
				{ dataset: "events", from_block: i * 10, path: `events/${i}.parquet` },
				{ dataset: "blocks", from_block: i * 10, path: `blocks/${i}.parquet` },
				{
					dataset: "transactions",
					from_block: i * 10,
					path: `transactions/${i}.parquet`,
				},
			],
		);
		const paths = loadOrder(manifestOrder).map((p) => p.path);
		const deps = stubDeps(async (_p, opts) => ({
			urls: (opts as { body: { paths: string[] } }).body.paths.map((path) => ({
				path,
				url: `https://fake.r2.example/${path}?sig=x`,
				expires_at: new Date(Date.now() + 900_000).toISOString(),
				charged_usd_micros: 0,
			})),
			charged_total_usd_micros: 0,
			balance_after_usd_micros: 0,
		}));
		const fetcher = createGatedFetcher(paths, "bootstrap", deps);

		await fetcher.getUrl("blocks/0.parquet");
		expect(deps.calls).toHaveLength(1);
		const charged = (deps.calls[0]?.opts as { body: { paths: string[] } }).body
			.paths;
		expect(charged).toHaveLength(16);
		expect(charged.every((p) => p.startsWith("blocks/"))).toBe(true);
	});

	test("a path outside the quoted batch throws rather than silently fetching everything", async () => {
		const deps = stubDeps(async () => ({
			urls: [],
			charged_total_usd_micros: 0,
			balance_after_usd_micros: 0,
		}));
		const fetcher = createGatedFetcher(["blocks/0.parquet"], "bootstrap", deps);
		expect(fetcher.getUrl("blocks/999.parquet")).rejects.toThrow(
			/was not in the quoted batch/,
		);
	});
});

describe("quote/insufficient message formatting", () => {
	function quote(overrides: Partial<ArchiveQuote> = {}): ArchiveQuote {
		return {
			partitions: 528,
			bundles: 176,
			usdMicros: 44_000_000,
			usd: "44.00",
			freeAllowanceAppliedMicros: 0,
			allowanceRemainingBundles: 6,
			balanceUsdMicros: 50_000_000,
			sufficient: true,
			...overrides,
		};
	}

	test("bootstrap quote line names the partitions, price, and balance", () => {
		expect(formatQuoteValue(quote(), "bootstrap")).toBe(
			"528 partitions ≈ $44.00 · balance $50.00",
		);
	});

	test("a fully-allowance-covered repair quote reads free with the remaining count", () => {
		const line = formatQuoteValue(
			quote({
				usdMicros: 0,
				usd: "0.00",
				freeAllowanceAppliedMicros: 150_000,
				allowanceRemainingBundles: 4,
			}),
			"repair",
		);
		expect(line).toBe("free (4 of 6 monthly repair fetches remaining)");
	});

	test("insufficient-balance message names the shortfall and the exact buy command", () => {
		const message = formatInsufficientMessage(
			quote({
				usdMicros: 44_000_000,
				usd: "44.00",
				balanceUsdMicros: 10_000_000,
			}),
		);
		expect(message).toBe(
			"Insufficient archive credits: quote $44.00, balance $10.00, short $34.00. Buy more with `secondlayer credits buy`.",
		);
	});
});

describe("consent is owed until -y says otherwise", () => {
	test("--json alone still requires confirmation; only -y waives it", () => {
		const jsonOnly: { yes?: boolean; json: boolean } = { json: true };
		expect(shouldPromptForGatedFetch({})).toBe(true);
		expect(shouldPromptForGatedFetch(jsonOnly)).toBe(true);
		expect(shouldPromptForGatedFetch({ yes: true })).toBe(false);
		expect(shouldPromptForGatedFetch({ ...jsonOnly, yes: true })).toBe(false);
	});

	test("the JSON refusal carries the quote and names -y as the remedy", () => {
		const quote: ArchiveQuote = {
			partitions: 3,
			bundles: 1,
			usd: "0.75",
			usdMicros: 750_000,
			balanceUsdMicros: 5_000_000,
			sufficient: true,
			freeAllowanceAppliedMicros: 0,
			allowanceRemainingBundles: 0,
		};
		const payload = confirmationRequiredPayload(quote);
		expect(payload.code).toBe("CONFIRMATION_REQUIRED");
		expect(payload.quote).toBe(quote);
		expect(payload.message).toMatch(/-y/);
		expect(payload.message).not.toMatch(/—/);
		expect(confirmationRequiredPayload(null).quote).toBeNull();
	});
});
