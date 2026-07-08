import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSession } from "../src/lib/session";

describe("writeSession", () => {
	let dir: string;
	let path: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "sl-session-"));
		path = join(dir, "session.json");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	const session = {
		token: "ss-sl_test",
		email: "a@example.com",
		accountId: "00000000-0000-0000-0000-000000000000",
		expiresAt: new Date().toISOString(),
	};

	it("creates the session file with mode 0600", async () => {
		await writeSession(session, path);
		const mode = (await stat(path)).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it("narrows an existing 0644 file to 0600 on overwrite", async () => {
		await writeFile(path, "stale", "utf8");
		await chmod(path, 0o644);
		expect((await stat(path)).mode & 0o777).toBe(0o644);

		await writeSession(session, path);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});
});
