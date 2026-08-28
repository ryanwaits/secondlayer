import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sha256File } from "../lib/fs.ts";
import { checkRestoredScope, pgRestoreInvocation } from "./backup.ts";

/**
 * The parts of backup/restore that decide whether a bundle is usable: the
 * dump digest has to survive a dump bigger than one Buffer, pg_restore has to
 * be all or nothing, and a restore that loaded fewer blocks than the manifest
 * promised has to fail rather than report success.
 */

const FS_MODULE = resolve(import.meta.dir, "../lib/fs.ts");
const SPARSE_BYTES = 2_200 * 1024 * 1024;
const HAS_NODE = spawnSync("node", ["--version"]).status === 0;

describe("dump digest", () => {
	let dir: string;
	let sparsePath: string;
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "sl-backup-hash-"));
		sparsePath = join(dir, "db.dump");
		// A sparse file costs no disk: only the trailing marker is materialized.
		const fh = await open(sparsePath, "w");
		try {
			await fh.truncate(SPARSE_BYTES - 1);
			await fh.write(Buffer.from([0x2a]), 0, 1, SPARSE_BYTES - 1);
		} finally {
			await fh.close();
		}
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test.skipIf(!HAS_NODE)(
		"a 2.2 GB dump hashes under node, where a single read would exceed the buffer limit",
		async () => {
			const driver = join(dir, "hash.mts");
			await writeFile(
				driver,
				`import { sha256File } from ${JSON.stringify(FS_MODULE)};\nprocess.stdout.write(await sha256File(process.argv[2]));\n`,
			);
			const run = spawnSync(
				"node",
				["--experimental-strip-types", "--no-warnings", driver, sparsePath],
				{ encoding: "utf8" },
			);
			expect(run.stderr).toBe("");
			expect(run.status).toBe(0);
			expect(run.stdout).toMatch(/^[0-9a-f]{64}$/);
			expect(run.stdout).toBe(await sha256File(sparsePath));
		},
		120_000,
	);

	test("the streamed digest matches a one-shot hash of the same bytes", async () => {
		const small = join(dir, "small.bin");
		const bytes = Buffer.from("not a real dump, but bytes all the same");
		await writeFile(small, bytes);
		expect(await sha256File(small)).toBe(
			createHash("sha256").update(bytes).digest("hex"),
		);
	});
});

describe("pg_restore invocation", () => {
	test("runs in one transaction and stops on the first error, so a failed restore rolls the target back", () => {
		const { cmd } = pgRestoreInvocation(
			"postgres://sl:pw@db.internal:5432/sl",
			"/bundle/db.dump",
		);
		expect(cmd[0]).toBe("pg_restore");
		expect(cmd).toContain("--single-transaction");
		expect(cmd).toContain("--exit-on-error");
		expect(cmd).toContain("--clean");
		expect(cmd).toContain("--if-exists");
		expect(cmd.some((a) => a === "-j" || a.startsWith("--jobs"))).toBe(false);
		expect(cmd.at(-1)).toBe("/bundle/db.dump");
	});
});

describe("post-restore scope check", () => {
	const manifest = { scope: { from_height: 0, to_height: 8_740_000 } };

	test("passes when the restored bounds match the manifest", () => {
		expect(
			checkRestoredScope(manifest, { fromHeight: 0, toHeight: 8_740_000 }),
		).toEqual({ ok: true });
	});

	test("fails when the restore stops short of the promised tip", () => {
		const result = checkRestoredScope(manifest, {
			fromHeight: 0,
			toHeight: 8_100_000,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("8100000");
			expect(result.reason).toContain("8740000");
		}
	});

	test("fails when the target holds no blocks at all", () => {
		const result = checkRestoredScope(manifest, {
			fromHeight: 0,
			toHeight: null,
		});
		expect(result.ok).toBe(false);
	});

	test("a bundle taken from a database with no canonical blocks restores clean into an empty target", () => {
		expect(
			checkRestoredScope(
				{ scope: { from_height: 0, to_height: null } },
				{ fromHeight: 0, toHeight: null },
			),
		).toEqual({ ok: true });
	});

	test("an open-ended manifest only pins the starting height", () => {
		expect(
			checkRestoredScope(
				{ scope: { from_height: 100, to_height: null } },
				{ fromHeight: 100, toHeight: 5_000 },
			),
		).toEqual({ ok: true });
	});
});
