import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPublicArchiveDir, mirrorToPublicArchive } from "./public-mirror.ts";

const original = process.env.ARCHIVE_PUBLIC_DIR;
const dirs: string[] = [];

async function publicDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "archive-public-"));
	dirs.push(dir);
	process.env.ARCHIVE_PUBLIC_DIR = dir;
	return dir;
}

afterEach(async () => {
	if (original === undefined) delete process.env.ARCHIVE_PUBLIC_DIR;
	else process.env.ARCHIVE_PUBLIC_DIR = original;
	await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true })));
});

describe("public archive mirror", () => {
	test("writes the pointer into the served tree", async () => {
		const dir = await publicDir();
		const written = await mirrorToPublicArchive({
			name: "status.json",
			value: { state: "lagging" },
		});

		expect(written).toBe(join(dir, "status.json"));
		expect(
			JSON.parse(await readFile(join(dir, "status.json"), "utf8")),
		).toEqual({ state: "lagging" });
	});

	test("leaves no temp file behind, so the tree only serves real objects", async () => {
		// The directory is served as a static file tree, so a stray `.tmp` would
		// be publicly fetchable.
		const dir = await publicDir();
		await mirrorToPublicArchive({ name: "latest.json", value: { a: 1 } });

		expect(await readdir(dir)).toEqual(["latest.json"]);
	});

	test("replaces an existing pointer rather than appending to it", async () => {
		const dir = await publicDir();
		await mirrorToPublicArchive({ name: "status.json", value: { n: 1 } });
		await mirrorToPublicArchive({ name: "status.json", value: { n: 2 } });

		expect(
			JSON.parse(await readFile(join(dir, "status.json"), "utf8")),
		).toEqual({ n: 2 });
	});

	test("does nothing when no public tree is configured", async () => {
		// Serving straight from object storage is a valid deployment, not a
		// misconfiguration to fail on.
		delete process.env.ARCHIVE_PUBLIC_DIR;

		expect(getPublicArchiveDir()).toBeNull();
		expect(
			await mirrorToPublicArchive({ name: "status.json", value: {} }),
		).toBeNull();
	});

	test("an unwritable tree fails loudly instead of silently diverging", async () => {
		// A pointer in the bucket but not in the served tree is the exact
		// split-brain this module closes; swallowing the error would recreate it.
		process.env.ARCHIVE_PUBLIC_DIR = join(tmpdir(), "archive-public-missing");

		expect(
			mirrorToPublicArchive({ name: "status.json", value: {} }),
		).rejects.toThrow();
	});
});
