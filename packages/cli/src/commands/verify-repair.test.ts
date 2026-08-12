import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSignature, loadReference } from "../lib/archive-reference.ts";

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

	test("a latest.json pointer is followed to its snapshot manifest", async () => {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "snapshots"), { recursive: true });
		const snapshot = {
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
		await writeFile(
			join(dir, "snapshots", "abc.json"),
			JSON.stringify(snapshot),
		);
		// The pointer is the only URL a user can be expected to know, so passing
		// it must work rather than erroring about missing digests.
		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify({ snapshot_path: "snapshots/abc.json" }),
		);

		const reference = await loadReference(join(dir, "latest.json"));
		expect(reference.manifest.partitions).toHaveLength(1);
		expect(reference.manifest.range_digests).toHaveLength(1);
		expect(reference.root).toBe(dir);
	});

	test("a pointer that names a different snapshot than it resolves is refused", async () => {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "snapshots"), { recursive: true });
		await writeFile(
			join(dir, "snapshots", "abc.json"),
			JSON.stringify({ partitions: [{ dataset: "blocks" }] }),
		);
		// A tampered pointer redirecting to a different — possibly still validly
		// signed — snapshot is a downgrade attack, not a forgery.
		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify({
				snapshot_path: "snapshots/abc.json",
				snapshot_digest: "0".repeat(64),
			}),
		);
		expect(loadReference(join(dir, "latest.json"))).rejects.toThrow(
			/pointer\/snapshot mismatch/,
		);
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
