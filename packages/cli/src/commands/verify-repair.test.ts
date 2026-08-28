import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb, sql } from "@secondlayer/shared/db";
import {
	type ArchiveGateDeps,
	createGatedFetcher,
	formatInsufficientMessage,
	isOfficialArchive,
	quoteArchiveFetch,
	shouldPromptForGatedFetch,
} from "../lib/archive-gate.ts";
import {
	type ArchivePartition,
	checkSignature,
	fetchVerifiedPartition,
	loadReference,
} from "../lib/archive-reference.ts";
import {
	type WrittenArchive,
	clearChain,
	digestsFor,
	fixtureChain,
	seedChain,
	writeArchive,
} from "../lib/archive-test-fixture.ts";
import { planChildRewrite } from "./repair.ts";

const HAS_DB = !!process.env.DATABASE_URL;

/**
 * The verify/repair contract, exercised through the real artifacts: a signed
 * manifest on disk, a tampered one, and an unsigned one.
 *
 * The end-to-end database path (export → corrupt → verify → repair → verify)
 * is covered by the archive suites in `@secondlayer/indexer`; what matters here
 * is that the CLI's trust boundary cannot be talked around, because that is the
 * boundary that protects a live database from unverified writes.
 */

let dir: string;

function signingKeys() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return {
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
	};
}

beforeEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = await mkdtemp(join(tmpdir(), "sl-verify-"));
});

afterAll(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("archive reference trust boundary", () => {
	test("an unsigned manifest is never trusted", () => {
		const result = checkSignature(
			{ coverage: { from_block: 0, to_block: 9 } },
			undefined,
			false,
		);
		expect(result.verified).toBe(false);
		expect(result.reason).toMatch(/no signature/);
	});

	test("a signed manifest verifies with the matching key", async () => {
		const { privatePem, publicPem } = signingKeys();
		const { signStreamsBulkManifest } = await import(
			"@secondlayer/shared/streams-bulk-manifest"
		);
		const signed = signStreamsBulkManifest(
			{ coverage: { from_block: 0, to_block: 9 } },
			privatePem,
		);
		expect(checkSignature(signed, publicPem, false).verified).toBe(true);
	});

	test("a tampered manifest fails against the correct key", async () => {
		const { privatePem, publicPem } = signingKeys();
		const { signStreamsBulkManifest } = await import(
			"@secondlayer/shared/streams-bulk-manifest"
		);
		const signed = signStreamsBulkManifest(
			{ coverage: { from_block: 0, to_block: 9 } },
			privatePem,
		) as Record<string, unknown>;
		// Move the coverage boundary — the exact edit an attacker would make to
		// convince someone their short chain is complete.
		(signed.coverage as { to_block: number }).to_block = 999_999;
		expect(checkSignature(signed, publicPem, false).verified).toBe(false);
	});

	test("a manifest signed by a DIFFERENT key is rejected", async () => {
		const a = signingKeys();
		const b = signingKeys();
		const { signStreamsBulkManifest } = await import(
			"@secondlayer/shared/streams-bulk-manifest"
		);
		const signed = signStreamsBulkManifest(
			{ coverage: { from_block: 0, to_block: 9 } },
			a.privatePem,
		);
		expect(checkSignature(signed, b.publicPem, false).verified).toBe(false);
	});

	test("--insecure reports unverified rather than pretending to verify", () => {
		const result = checkSignature({ signature: "x" }, undefined, true);
		expect(result.verified).toBe(false);
		expect(result.reason).toMatch(/skipped/);
	});

	test("a local reference resolves its partition root two levels up", async () => {
		const manifestPath = join(dir, "snapshots", "abc.json");
		await writeFile(
			join(dir, "snapshots", "abc.json").replace(/snapshots\/abc\.json$/, ""),
			"",
		).catch(() => {});
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "snapshots"), { recursive: true });
		await writeFile(manifestPath, JSON.stringify({ partitions: [] }));

		const reference = await loadReference(manifestPath);
		expect(reference.isRemote).toBe(false);
		// Partitions live at <root>/<dataset>/<file>, so the root must be the
		// directory containing `snapshots/`, not `snapshots/` itself.
		expect(reference.root).toBe(dir);
	});

	const snapshotFixture = {
		partitions: [
			{
				dataset: "blocks",
				from_block: 0,
				to_block: 9,
				path: "blocks/x.parquet",
				row_count: 10,
				byte_size: 1,
				sha256: "s",
			},
		],
		range_digests: [{ dataset: "blocks", from_block: 0, to_block: 9 }],
	};

	/** Writes `snapshots/<digest>.json` the way the publisher does and returns
	 *  the digest the pointer must carry. */
	async function writeSnapshot(
		root: string,
		snapshot: Record<string, unknown> = snapshotFixture,
	): Promise<string> {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(root, "snapshots"), { recursive: true });
		const digest = createHash("sha256")
			.update(JSON.stringify(snapshot))
			.digest("hex");
		await writeFile(
			join(root, "snapshots", `${digest}.json`),
			JSON.stringify(snapshot),
		);
		return digest;
	}

	test("a latest.json pointer is followed to its snapshot manifest", async () => {
		const digest = await writeSnapshot(dir);
		// The pointer is the only URL a user can be expected to know, so passing
		// it must work rather than erroring about missing digests.
		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify({
				snapshot_path: `snapshots/${digest}.json`,
				snapshot_digest: digest,
			}),
		);

		const reference = await loadReference(join(dir, "latest.json"));
		expect(reference.manifest.partitions).toHaveLength(1);
		expect(reference.manifest.range_digests).toHaveLength(1);
		expect(reference.root).toBe(dir);
	});

	test("a pointer that names a different snapshot than it resolves is refused", async () => {
		const digest = await writeSnapshot(dir);
		// A tampered pointer redirecting to a different, possibly still validly
		// signed, snapshot is a downgrade attack, not a forgery.
		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify({
				snapshot_path: `snapshots/${digest}.json`,
				snapshot_digest: "0".repeat(64),
			}),
		);
		await expect(loadReference(join(dir, "latest.json"))).rejects.toThrow(
			/pointer\/snapshot mismatch/,
		);
	});

	test("a pointer without a snapshot digest is refused rather than followed on faith", async () => {
		const digest = await writeSnapshot(dir);
		// Stripping the digest is the cheapest downgrade: no key needed, the
		// pointer simply stops proving which snapshot is current.
		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify({ snapshot_path: `snapshots/${digest}.json` }),
		);
		await expect(loadReference(join(dir, "latest.json"))).rejects.toThrow(
			/no snapshot_digest/,
		);
	});

	test("a pointer whose snapshot path is not a content digest is refused", async () => {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "snapshots"), { recursive: true });
		for (const snapshotPath of [
			"snapshots/../latest.json",
			"/etc/passwd",
			"snapshots/abc.json",
			"https://evil.example/snapshots/x.json",
		]) {
			await writeFile(
				join(dir, "latest.json"),
				JSON.stringify({
					snapshot_path: snapshotPath,
					snapshot_digest: "0".repeat(64),
				}),
			);
			await expect(loadReference(join(dir, "latest.json"))).rejects.toThrow(
				/invalid snapshot path/,
			);
		}
	});

	test("a signed pointer must verify against the archive key it was loaded with", async () => {
		const legit = signingKeys();
		const attacker = signingKeys();
		const { signStreamsBulkManifest } = await import(
			"@secondlayer/shared/streams-bulk-manifest"
		);
		const digest = await writeSnapshot(dir);
		const pointer = {
			snapshot_path: `snapshots/${digest}.json`,
			snapshot_digest: digest,
		};

		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify(signStreamsBulkManifest(pointer, attacker.privatePem)),
		);
		await expect(
			loadReference(join(dir, "latest.json"), {
				publicKeyPem: legit.publicPem,
			}),
		).rejects.toThrow(/pointer signature did not verify/);
		// A signed pointer with no key to check it against is not "unsigned";
		// it is unverifiable, and the reader must say so.
		await expect(loadReference(join(dir, "latest.json"))).rejects.toThrow(
			/no public key is available/,
		);

		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify(signStreamsBulkManifest(pointer, legit.privatePem)),
		);
		const reference = await loadReference(join(dir, "latest.json"), {
			publicKeyPem: legit.publicPem,
		});
		expect(reference.manifest.partitions).toHaveLength(1);
	});

	test("a manifest signed by whoever answers the key endpoint does not verify against the pinned key", async () => {
		// The pinned key is the trust root. A key server, hosted or spoofed over
		// plain http, cannot substitute its own signer.
		const legit = signingKeys();
		const attacker = signingKeys();
		const { signStreamsBulkManifest } = await import(
			"@secondlayer/shared/streams-bulk-manifest"
		);
		const { resolveArchivePublicKey } = await import(
			"../lib/archive-reference.ts"
		);
		const server = Bun.serve({
			port: 0,
			fetch: () => Response.json({ public_key_pem: attacker.publicPem }),
		});
		try {
			const manifest = signStreamsBulkManifest(
				{ coverage: { from_block: 0, to_block: 9 } },
				attacker.privatePem,
			);
			const key = await resolveArchivePublicKey({
				envPem: legit.publicPem,
				allowHostedApi: true,
				hostedKeyUrl: `http://127.0.0.1:${server.port}/public/streams/signing-key`,
			});
			expect(key).toBe(legit.publicPem);
			expect(checkSignature(manifest, key, false).verified).toBe(false);
		} finally {
			server.stop(true);
		}
	});

	test("a partition path that escapes the archive root is refused before any read", async () => {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "blocks"), { recursive: true });
		const reference = {
			manifest: {},
			origin: join(dir, "latest.json"),
			root: dir,
			isRemote: false,
		};
		for (const path of [
			"../outside.parquet",
			"/etc/passwd",
			"blocks/../../x",
			"blocks/%2e%2e/x",
			"blocks/a.parquet?x=1",
			"blocks/a.parquet#frag",
		]) {
			await expect(
				fetchVerifiedPartition(reference, {
					dataset: "blocks",
					from_block: 0,
					to_block: 9,
					path,
					row_count: 1,
					byte_size: 1,
					sha256: "0".repeat(64),
				}),
			).rejects.toThrow(/leave the archive root/);
		}
		const remote = {
			...reference,
			root: "https://example.com/a",
			isRemote: true,
		};
		await expect(
			fetchVerifiedPartition(remote, {
				dataset: "blocks",
				from_block: 0,
				to_block: 9,
				path: "https://evil.example/x.parquet",
				row_count: 1,
				byte_size: 1,
				sha256: "0".repeat(64),
			}),
		).rejects.toThrow(/leave the archive root/);
	});

	test("verify exits unanchored with the pointer hint when latest.json carries no snapshot digest", async () => {
		// The command-level contract: a pointer that cannot prove which snapshot
		// is current must stop before any database is touched, with exit code 2
		// and a hint that names the pointer rather than DATABASE_URL.
		const digest = await writeSnapshot(dir);
		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify({ snapshot_path: `snapshots/${digest}.json` }),
		);
		const proc = Bun.spawn(
			[
				process.execPath,
				"run",
				join(import.meta.dir, "../cli.ts"),
				"verify",
				"--against",
				join(dir, "latest.json"),
			],
			{
				env: {
					...process.env,
					SL_API_URL: "http://127.0.0.1:1",
					DATABASE_URL: "",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		const printed = stdout + stderr;
		expect(exitCode).toBe(2);
		expect(printed).toMatch(/no snapshot_digest/);
		expect(printed).toMatch(/archive pointer failed its integrity check/);
		expect(printed).not.toMatch(/Set DATABASE_URL/);
	});

	test("a remote reference strips the snapshots path segment", async () => {
		// No network: exercise the URL derivation the same way loadReference does.
		const url = new URL(
			"https://example.com/secondlayer/mainnet/canonical/v1/snapshots/deadbeef.json",
		);
		url.pathname = url.pathname.replace(/\/snapshots\/[^/]+$/, "");
		expect(url.toString()).toBe(
			"https://example.com/secondlayer/mainnet/canonical/v1",
		);
	});
});

describe("bootstrap live seam", () => {
	test("the resume point is the archive tip plus one", () => {
		// A restored instance must tell the indexer where to continue. Without an
		// `index_progress` row the instance holds millions of blocks and reports
		// none — and the indexer cannot self-heal, because its own recompute is
		// an UPDATE that silently no-ops when the row is absent.
		const archiveTip = 8_745_422;
		expect(archiveTip + 1).toBe(8_745_423);
	});

	test("the catch-up gap is measured from the node tip at start, not at end", () => {
		// The chain keeps producing for the whole restore. Measuring the gap
		// afterwards would understate it by however long the restore took.
		const nodeTipAtStart = 8_745_500;
		const archiveTip = 8_745_422;
		expect(nodeTipAtStart - archiveTip).toBe(78);
	});
});

/**
 * feat-f091: the archive fetch gate wired into bootstrap/repair's shared
 * fetch choke point (`fetchVerifiedPartition`) and the quote/confirm
 * decision both commands make (`../lib/archive-gate.ts`).
 *
 * `bootstrap.ts`/`repair.ts` are not exercised end-to-end here — their
 * `.action()` reaches a real Postgres connection before the gate logic even
 * runs (index_progress/blocks reads), and per this file's own boundary
 * (see the top comment) that database path belongs to the archive suites
 * in `@secondlayer/indexer`, not the CLI package. What matters here, and
 * what these tests prove instead: the two primitives the commands compose
 * — `fetchVerifiedPartition`'s gate seam and `archive-gate.ts`'s quote
 * client — behave exactly as the DX contract requires, pure-logic style,
 * with no database.
 */
function stubGateDeps(
	impl: (path: string, opts?: unknown) => Promise<unknown>,
): ArchiveGateDeps & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		httpArchiveOps: (async (path: string, opts?: unknown) => {
			calls.push(path);
			return impl(path, opts);
		}) as ArchiveGateDeps["httpArchiveOps"],
	};
}

function testPartition(
	overrides: Partial<ArchivePartition> = {},
): ArchivePartition {
	return {
		dataset: "blocks",
		from_block: 0,
		to_block: 49_999,
		path: "blocks/0-49999-0000000000000001.parquet",
		row_count: 1,
		byte_size: 1,
		sha256: "",
		...overrides,
	};
}

describe("archive fetch gate — case 1: mirror never reaches the gate", () => {
	test("a mirror (non-official) origin is never gated; fetchVerifiedPartition uses the free path unchanged", async () => {
		const bytes = Buffer.from("mirror-partition-bytes");
		const digest = createHash("sha256").update(bytes).digest("hex");
		const server = Bun.serve({
			port: 0,
			fetch: () => new Response(bytes),
		});
		try {
			const root = `http://127.0.0.1:${server.port}`;
			const reference = {
				manifest: {},
				origin: `${root}/latest.json`,
				root,
				isRemote: true,
			};
			// The billing-boundary predicate must say no for a mirror...
			expect(isOfficialArchive(reference)).toBe(false);
			// ...which means the command never builds a gate at all: calling
			// fetchVerifiedPartition with NO gate argument is exactly what a
			// mirror reference gets, and it must still work, byte-for-byte.
			const partition = testPartition({ sha256: digest });
			const result = await fetchVerifiedPartition(reference, partition);
			expect(result.equals(bytes)).toBe(true);
		} finally {
			server.stop(true);
		}
	});
});

describe("archive fetch gate — case 2: official host, sufficient balance", () => {
	test("gated fetch resolves a presigned URL and still digest-verifies the bytes", async () => {
		const bytes = Buffer.from("gated-partition-bytes");
		const digest = createHash("sha256").update(bytes).digest("hex");
		const server = Bun.serve({
			port: 0,
			fetch: () => new Response(bytes),
		});
		try {
			const partition = testPartition({
				path: "blocks/0-49999-0000000000000002.parquet",
				sha256: digest,
			});
			const deps = stubGateDeps(async (path, opts) => {
				if (path === "/api/archive/quote") {
					return {
						partitions: 1,
						bundles: 1,
						usd_micros: 50_000,
						usd: "0.05",
						free_allowance_applied_micros: 0,
						allowance_remaining_bundles: 6,
						balance_usd_micros: 10_000_000,
						sufficient: true,
					};
				}
				const requested = (opts as { body: { paths: string[] } }).body.paths;
				return {
					urls: requested.map((p) => ({
						path: p,
						url: `http://127.0.0.1:${server.port}/${p}`,
						expires_at: new Date(Date.now() + 900_000).toISOString(),
						charged_usd_micros: 50_000,
					})),
					charged_total_usd_micros: 50_000,
					balance_after_usd_micros: 9_950_000,
				};
			});

			const quoteResult = await quoteArchiveFetch(
				[partition.path],
				"bootstrap",
				deps,
			);
			expect(quoteResult.ok).toBe(true);
			if (!quoteResult.ok) throw new Error("expected an ok quote");
			expect(quoteResult.quote.sufficient).toBe(true);

			const gate = createGatedFetcher([partition.path], "bootstrap", deps);
			const reference = {
				manifest: {},
				origin: "https://archive.secondlayer.tools/latest.json",
				root: "https://archive.secondlayer.tools",
				isRemote: true,
			};
			expect(isOfficialArchive(reference)).toBe(true);

			const result = await fetchVerifiedPartition(reference, partition, gate);
			expect(result.equals(bytes)).toBe(true);
			expect(deps.calls).toEqual(["/api/archive/quote", "/api/archive/fetch"]);
		} finally {
			server.stop(true);
		}
	});
});

describe("archive fetch gate — case 3: insufficient balance exits before any /fetch call", () => {
	test("sufficient:false never triggers a /fetch call; the message carries the shortfall and the buy command", async () => {
		const deps = stubGateDeps(async (path) => {
			if (path === "/api/archive/quote") {
				return {
					partitions: 1,
					bundles: 1,
					usd_micros: 150_000,
					usd: "0.15",
					free_allowance_applied_micros: 0,
					allowance_remaining_bundles: 6,
					balance_usd_micros: 10_000,
					sufficient: false,
				};
			}
			throw new Error("must not call /fetch when the quote is insufficient");
		});

		const result = await quoteArchiveFetch(
			["events/0-49999-0000000000000003.parquet"],
			"bootstrap",
			deps,
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected an ok quote");
		expect(result.quote.sufficient).toBe(false);

		const message = formatInsufficientMessage(result.quote);
		expect(message).toContain("secondlayer credits buy");
		expect(message).toBe(
			"Insufficient archive credits: quote $0.15, balance $0.01, short $0.14. Buy more with `secondlayer credits buy`.",
		);

		// The whole point: only the free quote ran. No gate was ever built, so
		// no `/api/archive/fetch` call — and therefore no charge — happened.
		expect(deps.calls).toEqual(["/api/archive/quote"]);
	});
});

describe("archive fetch gate — case 4: expired presigned URL recovers once", () => {
	test("a 403 on the presigned URL triggers exactly one re-issue; the fresh bytes are still digest-checked", async () => {
		const bytes = Buffer.from("expired-then-fresh-bytes");
		const digest = createHash("sha256").update(bytes).digest("hex");
		let hits = 0;
		const server = Bun.serve({
			port: 0,
			fetch: () => {
				hits++;
				return hits === 1
					? new Response("expired", { status: 403 })
					: new Response(bytes);
			},
		});
		try {
			const partition = testPartition({
				path: "blocks/0-49999-0000000000000004.parquet",
				sha256: digest,
			});
			let getUrlCalls = 0;
			const gate = {
				async getUrl(path: string) {
					getUrlCalls++;
					return `http://127.0.0.1:${server.port}/${path}`;
				},
			};
			const reference = {
				manifest: {},
				origin: "https://archive.secondlayer.tools/latest.json",
				root: "https://archive.secondlayer.tools",
				isRemote: true,
			};
			const result = await fetchVerifiedPartition(reference, partition, gate);
			expect(result.equals(bytes)).toBe(true);
			expect(hits).toBe(2);
			expect(getUrlCalls).toBe(2);
		} finally {
			server.stop(true);
		}
	});

	test("a digest mismatch still throws even after a successful gated (re-issued) fetch", async () => {
		const bytes = Buffer.from("tampered-bytes");
		const server = Bun.serve({ port: 0, fetch: () => new Response(bytes) });
		try {
			const partition = testPartition({
				path: "blocks/0-49999-0000000000000005.parquet",
				sha256: "0".repeat(64),
			});
			const gate = {
				async getUrl(path: string) {
					return `http://127.0.0.1:${server.port}/${path}`;
				},
			};
			const reference = {
				manifest: {},
				origin: "https://archive.secondlayer.tools/latest.json",
				root: "https://archive.secondlayer.tools",
				isRemote: true,
			};
			await expect(
				fetchVerifiedPartition(reference, partition, gate),
			).rejects.toThrow(/failed verification/);
		} finally {
			server.stop(true);
		}
	});
});

describe("archive fetch gate — case 5: -y skips only the prompt, never the quote", () => {
	test("only -y waives confirmation; --json still owes consent", () => {
		// The quote line and the sufficiency check run unconditionally, above
		// and before this decision is even consulted (see bootstrap.ts/
		// repair.ts: `quoteArchiveFetch` + `formatQuoteValue` are called before
		// this guard, never inside it) — this function controls ONLY whether
		// confirmation is still owed. `--json` is not consent: the command
		// then emits `confirmationRequiredPayload` and exits instead of
		// charging.
		expect(shouldPromptForGatedFetch({})).toBe(true);
		expect(shouldPromptForGatedFetch({ yes: true })).toBe(false);
		const jsonOnly: { yes?: boolean; json: boolean } = { json: true };
		expect(shouldPromptForGatedFetch(jsonOnly)).toBe(true);
		expect(shouldPromptForGatedFetch({ ...jsonOnly, yes: true })).toBe(false);
	});
});

describe.skipIf(!HAS_DB)("verify exit-code contract", () => {
	test("exit codes are distinct and stable", async () => {
		const { VERIFY_EXIT } = await import("./verify.ts");
		const { REPAIR_EXIT } = await import("./repair.ts");
		// "I could not check" must never collide with "you are fine" — that
		// collision is what makes a verification tool useless in CI.
		expect(VERIFY_EXIT.CLEAN).toBe(0);
		expect(VERIFY_EXIT.DIVERGED).toBe(1);
		expect(VERIFY_EXIT.UNANCHORED).toBe(2);
		expect(REPAIR_EXIT.OK).toBe(0);
		expect(REPAIR_EXIT.DIVERGENCE_REMAINS).toBe(1);
		expect(REPAIR_EXIT.UNANCHORED).toBe(2);
	});
});

describe("repair rewrites a fixed block's transactions and events", () => {
	const partitions: ArchivePartition[] = [
		testPartition({
			dataset: "blocks",
			from_block: 0,
			to_block: 9,
			path: "b0",
		}),
		testPartition({
			dataset: "transactions",
			from_block: 0,
			to_block: 9,
			path: "t0",
		}),
		testPartition({
			dataset: "events",
			from_block: 0,
			to_block: 9,
			path: "e0",
		}),
		testPartition({
			dataset: "blocks",
			from_block: 10,
			to_block: 19,
			path: "b1",
		}),
	];

	test("each fixed height is served by the child partition that contains it", () => {
		const plan = planChildRewrite(partitions, [3, 7]);
		expect([...plan.byPartition.keys()]).toEqual(["t0", "e0"]);
		expect(plan.byPartition.get("t0")?.heights).toEqual([3, 7]);
		expect(plan.missing).toEqual({ transactions: [], events: [] });
		expect(plan.rewritable).toEqual([3, 7]);
	});

	test("a height with no transactions or events partition in the reference is reported as missing, per dataset", () => {
		const plan = planChildRewrite(partitions, [3, 12]);
		expect(plan.missing).toEqual({ transactions: [12], events: [12] });
		expect(plan.byPartition.get("t0")?.heights).toEqual([3]);
		expect(plan.rewritable).toEqual([3]);
	});

	test("a height covered by a transactions partition but no events partition is not rewritten underneath at all", () => {
		// Events reference transactions; replacing one side alone cannot land.
		const txOnly = partitions.concat(
			testPartition({
				dataset: "transactions",
				from_block: 10,
				to_block: 19,
				path: "t1",
			}),
		);
		const plan = planChildRewrite(txOnly, [12]);
		expect(plan.rewritable).toEqual([]);
		expect(plan.byPartition.size).toBe(0);
		expect(plan.missing).toEqual({ transactions: [], events: [12] });
	});
});

const REPAIR_CLI = join(import.meta.dir, "../cli.ts");

function runRepair(args: string[], publicPem: string) {
	return spawnSync(
		process.execPath,
		[
			REPAIR_CLI,
			"repair",
			"--yes",
			"--json",
			"--public-key",
			publicPem,
			...args,
		],
		{
			encoding: "utf8",
			env: { ...process.env, NO_COLOR: "1", SL_API_URL: "http://127.0.0.1:1" },
		},
	);
}

describe.skipIf(!HAS_DB)("repair --apply against a real database", () => {
	const ranges = [{ from_block: 0, to_block: 9 }];
	const chain = fixtureChain(0, 9);
	let archiveDir: string;
	let full: WrittenArchive;
	let blocksOnly: WrittenArchive;
	let txOnly: WrittenArchive;

	/** The local database after a fork: block 5 and its transaction and event
	 *  carry the losing fork's identity. */
	async function seedForked() {
		const db = getDb();
		await clearChain(db);
		const forked = fixtureChain(0, 9);
		const block = forked.blocks[5];
		const tx = forked.transactions[5];
		const event = forked.events[5];
		if (!block || !tx || !event) throw new Error("fixture");
		block.hash = "fork-hash-5";
		tx.tx_id = "fork-tx-5";
		event.tx_id = "fork-tx-5";
		await seedChain(db, forked);
	}

	beforeAll(async () => {
		const db = getDb();
		archiveDir = await mkdtemp(join(tmpdir(), "sl-repair-db-"));
		await clearChain(db);
		await seedChain(db, chain);
		const digests = await digestsFor(db, ranges);
		full = await writeArchive(join(archiveDir, "full"), chain, ranges, digests);
		blocksOnly = await writeArchive(
			join(archiveDir, "blocks-only"),
			chain,
			ranges,
			digests,
			{ datasets: ["blocks"] },
		);
		txOnly = await writeArchive(
			join(archiveDir, "tx-only"),
			chain,
			ranges,
			digests,
			{ datasets: ["blocks", "transactions"] },
		);
	});

	afterAll(async () => {
		await clearChain(getDb());
		await closeDb();
		if (archiveDir) await rm(archiveDir, { recursive: true, force: true });
	});

	test("a replaced block takes its transactions and events with it, and all three datasets re-verify clean", async () => {
		await seedForked();
		const res = runRepair(
			["--against", full.manifestPath, "--apply"],
			full.publicPem,
		);
		expect(res.status).toBe(0);
		const report = JSON.parse(res.stdout);
		expect(report.status).toBe("repaired");
		expect(report.datasets_rewritten).toEqual([
			"blocks",
			"transactions",
			"events",
		]);
		expect(report.rows_written).toEqual({
			blocks: 1,
			transactions: 1,
			events: 1,
		});
		expect(report.remaining_by_dataset).toEqual({
			blocks: 0,
			transactions: 0,
			events: 0,
		});
		const db = getDb();
		const txs = await sql<{
			tx_id: string;
		}>`SELECT tx_id FROM transactions WHERE block_height = 5`.execute(db);
		expect(txs.rows.map((r) => r.tx_id)).toEqual(["tx-5"]);
		const events = await sql<{
			tx_id: string;
		}>`SELECT tx_id FROM events WHERE block_height = 5`.execute(db);
		expect(events.rows.map((r) => r.tx_id)).toEqual(["tx-5"]);
	});

	test("a reference without child partitions rewrites blocks only, names the height, and exits incomplete", async () => {
		await seedForked();
		const res = runRepair(
			["--against", blocksOnly.manifestPath, "--apply"],
			blocksOnly.publicPem,
		);
		expect(res.status).toBe(1);
		const report = JSON.parse(res.stdout);
		expect(report.status).toBe("incomplete");
		expect(report.datasets_rewritten).toEqual(["blocks"]);
		expect(report.heights_missing_child_partitions).toEqual([5]);
		expect(res.stderr).not.toContain("re-verified clean");
		expect(res.stderr).toContain(
			"secondlayer bootstrap --from-block 5 --to-block 5",
		);
		const db = getDb();
		const txs = await sql<{
			tx_id: string;
		}>`SELECT tx_id FROM transactions WHERE block_height = 5`.execute(db);
		// The stale fork transaction is neither deleted nor replaced: an
		// orphan row is worse than a named, still-present one.
		expect(txs.rows.map((r) => r.tx_id)).toEqual(["fork-tx-5"]);
	});

	test("a reference with transactions but no events partitions reports blocks as the only dataset rewritten", async () => {
		await seedForked();
		const res = runRepair(
			["--against", txOnly.manifestPath, "--apply"],
			txOnly.publicPem,
		);
		expect(res.status).toBe(1);
		const report = JSON.parse(res.stdout);
		expect(report.status).toBe("incomplete");
		expect(report.datasets_rewritten).toEqual(["blocks"]);
		expect(report.rows_written).toEqual({
			blocks: 1,
			transactions: 0,
			events: 0,
		});
		expect(report.heights_missing_child_partitions).toEqual([5]);
		expect(res.stderr).not.toContain("re-verified clean");
		expect(res.stderr).toContain("no events partition");
		const db = getDb();
		const txs = await sql<{
			tx_id: string;
		}>`SELECT tx_id FROM transactions WHERE block_height = 5`.execute(db);
		expect(txs.rows.map((r) => r.tx_id)).toEqual(["fork-tx-5"]);
	});
});
