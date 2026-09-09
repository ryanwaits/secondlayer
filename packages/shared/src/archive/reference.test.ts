import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signStreamsBulkManifest } from "../streams-bulk-manifest.ts";
import { checkSignature, loadReference } from "./reference.ts";

function signingKeys() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	return {
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
	};
}

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
};

async function writeSnapshot(
	root: string,
	snapshot: Record<string, unknown> = snapshotFixture,
): Promise<string> {
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

let dir: string;

beforeEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
	dir = await mkdtemp(join(tmpdir(), "sl-archive-ref-"));
});

afterAll(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});

describe("loadReference pointer follow", () => {
	test("latest.json with snapshot_path + matching snapshot_digest resolves the snapshot", async () => {
		const digest = await writeSnapshot(dir);
		await writeFile(
			join(dir, "latest.json"),
			JSON.stringify({
				snapshot_path: `snapshots/${digest}.json`,
				snapshot_digest: digest,
			}),
		);
		const reference = await loadReference(join(dir, "latest.json"));
		expect(reference.manifest.partitions).toHaveLength(1);
		expect(reference.root).toBe(dir);
	});

	test("pointer mismatch throws", async () => {
		const digest = await writeSnapshot(dir);
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
});

describe("checkSignature", () => {
	test("unsigned → { verified: false }", () => {
		const result = checkSignature(
			{ coverage: { from_block: 0, to_block: 9 } },
			undefined,
			false,
		);
		expect(result.verified).toBe(false);
		expect(result.reason).toMatch(/no signature/);
	});

	test("insecure → skipped", () => {
		const result = checkSignature({ signature: "x" }, undefined, true);
		expect(result.verified).toBe(false);
		expect(result.reason).toMatch(/skipped/);
	});

	test("valid ed25519 → verified", () => {
		const { privatePem, publicPem } = signingKeys();
		const signed = signStreamsBulkManifest(
			{ coverage: { from_block: 0, to_block: 9 } },
			privatePem,
		);
		expect(checkSignature(signed, publicPem, false).verified).toBe(true);
	});
});
