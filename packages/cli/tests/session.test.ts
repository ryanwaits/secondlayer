import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	chmod,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCHIVE_OPS_API_URL } from "../src/lib/api-url";
import { clearSession, readSession, writeSession } from "../src/lib/session";

const INSTANCE_URL = "http://127.0.0.1:3800";

describe("session store", () => {
	let dir: string;
	let path: string;
	let savedCreditsUrl: string | undefined;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "sl-session-"));
		path = join(dir, "session.json");
		savedCreditsUrl = process.env.SL_CREDITS_API_URL;
		Reflect.deleteProperty(process.env, "SL_CREDITS_API_URL");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
		if (savedCreditsUrl === undefined) {
			Reflect.deleteProperty(process.env, "SL_CREDITS_API_URL");
		} else process.env.SL_CREDITS_API_URL = savedCreditsUrl;
	});

	const session = {
		token: "ss-sl_test",
		email: "a@example.com",
		accountId: "00000000-0000-0000-0000-000000000000",
		expiresAt: new Date().toISOString(),
	};

	it("creates the session file with mode 0600", async () => {
		await writeSession(session, INSTANCE_URL, path);
		const mode = (await stat(path)).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it("narrows an existing 0644 file to 0600 on overwrite", async () => {
		await writeFile(path, "stale", "utf8");
		await chmod(path, 0o644);
		expect((await stat(path)).mode & 0o777).toBe(0o644);

		await writeSession(session, INSTANCE_URL, path);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it("keeps one session per API URL so the credits login never reaches the instance", async () => {
		const credits = { ...session, token: "ss-sl_credits" };
		await writeSession(session, INSTANCE_URL, path);
		await writeSession(credits, ARCHIVE_OPS_API_URL, path);

		expect((await readSession(INSTANCE_URL, path))?.token).toBe("ss-sl_test");
		expect((await readSession(ARCHIVE_OPS_API_URL, path))?.token).toBe(
			"ss-sl_credits",
		);
		expect(await readSession("https://other.example", path)).toBeNull();

		const onDisk = JSON.parse(await readFile(path, "utf8"));
		expect(Object.keys(onDisk.sessions).sort()).toEqual(
			[INSTANCE_URL, ARCHIVE_OPS_API_URL].sort(),
		);
	});

	it("ignores a trailing slash when keying sessions", async () => {
		await writeSession(session, `${INSTANCE_URL}/`, path);
		expect((await readSession(INSTANCE_URL, path))?.token).toBe("ss-sl_test");
	});

	it("reads the old flat session file as the archive credits login", async () => {
		await writeFile(path, JSON.stringify(session), "utf8");
		expect((await readSession(ARCHIVE_OPS_API_URL, path))?.token).toBe(
			"ss-sl_test",
		);
		expect(await readSession(INSTANCE_URL, path)).toBeNull();
	});

	it("writes the scoped shape over an old flat file without losing the upgraded login", async () => {
		await writeFile(path, JSON.stringify(session), "utf8");
		await writeSession(
			{ ...session, token: "ss-sl_instance" },
			INSTANCE_URL,
			path,
		);
		const onDisk = JSON.parse(await readFile(path, "utf8"));
		expect(onDisk.sessions[ARCHIVE_OPS_API_URL].token).toBe("ss-sl_test");
		expect(onDisk.sessions[INSTANCE_URL].token).toBe("ss-sl_instance");
	});

	it("clearing one URL leaves the other login in place and removes the file when empty", async () => {
		await writeSession(session, INSTANCE_URL, path);
		await writeSession(session, ARCHIVE_OPS_API_URL, path);
		await clearSession(INSTANCE_URL, path);
		expect(await readSession(INSTANCE_URL, path)).toBeNull();
		expect(await readSession(ARCHIVE_OPS_API_URL, path)).not.toBeNull();
		await clearSession(ARCHIVE_OPS_API_URL, path);
		await expect(stat(path)).rejects.toThrow();
	});

	it("treats a malformed file as no session", async () => {
		await writeFile(path, "{not json", "utf8");
		expect(await readSession(INSTANCE_URL, path)).toBeNull();
	});
});
