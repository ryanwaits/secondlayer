import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { StreamsDumpFile } from "@secondlayer/sdk";
import {
	pgConnection,
	pgDumpInvocation,
	pgRestoreInvocation,
} from "../src/commands/backup.ts";
import { writeSigningSecretEnv } from "../src/commands/create.ts";
import { downloadDumpTo, resolveDumpDest } from "../src/commands/streams.ts";

/**
 * Local hardening: what the CLI writes to disk and what it hands other
 * processes. A manifest path is input, a database password is a secret, and
 * a `.env` holding a signing secret is owner-only.
 */

function dumpFile(path: string, body: Uint8Array): StreamsDumpFile {
	return {
		path,
		sha256: createHash("sha256").update(body).digest("hex"),
	} as unknown as StreamsDumpFile;
}

describe("streams dumps keeps every manifest path under --to", () => {
	it("a manifest entry with a .. segment is refused before anything is written", () => {
		expect(() => resolveDumpDest("./dumps", "../escaped/pwned.txt")).toThrow(
			/refusing dump path/,
		);
		expect(() => resolveDumpDest("./dumps", "a/../../x")).toThrow(
			/refusing dump path/,
		);
	});

	it("an absolute manifest entry is refused", () => {
		expect(() => resolveDumpDest("./dumps", "/etc/passwd")).toThrow(
			/refusing dump path/,
		);
		expect(() => resolveDumpDest("./dumps", "")).toThrow(/refusing dump path/);
	});

	it("a relative entry resolves under --to", () => {
		const root = resolve("./dumps");
		expect(resolveDumpDest("./dumps", "events/0001.parquet")).toBe(
			`${root}${sep}events${sep}0001.parquet`,
		);
	});
});

describe("streams dumps writes through a .part file", () => {
	let server: ReturnType<typeof Bun.serve>;
	let base = "";
	const body = new TextEncoder().encode("parquet bytes that are fully served");

	beforeAll(() => {
		server = Bun.serve({
			port: 0,
			fetch(req) {
				const path = new URL(req.url).pathname;
				if (path === "/full") return new Response(body);
				if (path === "/wrong") return new Response("different bytes");
				if (path === "/cut") {
					// Declare more than we send, then drop the connection mid-body.
					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(body.subarray(0, 8));
							controller.error(new Error("connection reset"));
						},
					});
					return new Response(stream, {
						headers: { "content-length": String(body.byteLength) },
					});
				}
				return new Response("nope", { status: 404 });
			},
		});
		base = `http://127.0.0.1:${server.port}`;
	});
	afterAll(() => server.stop(true));

	it("a completed download is renamed into place once the sha256 matches, leaving no .part", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-dumps-"));
		try {
			const file = dumpFile("events/0001.parquet", body);
			const dest = resolveDumpDest(dir, file.path);
			const bytes = await downloadDumpTo(file, dest, fetch, `${base}/full`);
			expect(bytes).toBe(body.byteLength);
			expect(new Uint8Array(await readFile(dest))).toEqual(body);
			expect(readdirSync(join(dir, "events"))).toEqual(["0001.parquet"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("an interrupted download leaves only the .part file, never a truncated final file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-dumps-"));
		try {
			const file = dumpFile("events/0001.parquet", body);
			const dest = resolveDumpDest(dir, file.path);
			await expect(
				downloadDumpTo(file, dest, fetch, `${base}/cut`),
			).rejects.toThrow();
			expect(existsSync(dest)).toBe(false);
			expect(readdirSync(join(dir, "events"))).toEqual(["0001.parquet.part"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("a digest mismatch names the .part and never renames it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-dumps-"));
		try {
			const file = dumpFile("events/0001.parquet", body);
			const dest = resolveDumpDest(dir, file.path);
			await expect(
				downloadDumpTo(file, dest, fetch, `${base}/wrong`),
			).rejects.toThrow(/sha256 mismatch/);
			expect(existsSync(dest)).toBe(false);
			expect(existsSync(`${dest}.part`)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("backup and restore keep the database password off argv", () => {
	const url = "postgres://sl:S3cret%40PW@db:5432/sl";

	it("the password moves into PGPASSWORD and the URL keeps user, host, and database", () => {
		const conn = pgConnection(url);
		expect(conn.env).toEqual({ PGPASSWORD: "S3cret@PW" });
		expect(conn.url).not.toContain("S3cret");
		expect(conn.url).toBe("postgres://sl@db:5432/sl");
	});

	it("a URL without a password is passed through with an empty env", () => {
		expect(pgConnection("postgres://sl@db/sl")).toEqual({
			url: "postgres://sl@db/sl",
			env: {},
		});
	});

	it("pg_dump and pg_restore argv never carry the password", () => {
		const dump = pgDumpInvocation(url, "/tmp/db.dump");
		const restore = pgRestoreInvocation(url, "/tmp/db.dump");
		for (const inv of [dump, restore]) {
			expect(inv.cmd.join(" ")).not.toContain("S3cret");
			expect(inv.env.PGPASSWORD).toBe("S3cret@PW");
		}
		expect(dump.cmd[0]).toBe("pg_dump");
		expect(restore.cmd[0]).toBe("pg_restore");
	});

	it("a child spawned with the invocation shows no password in ps", async () => {
		const inv = pgDumpInvocation(url, "/tmp/db.dump");
		// Stand in for pg_dump with a sleeper that takes the same argv tail.
		const proc = Bun.spawn(
			["sh", "-c", "sleep 2; true", "sh", ...inv.cmd.slice(1)],
			{
				env: { ...process.env, ...inv.env },
			},
		);
		try {
			await Bun.sleep(200);
			const ps = Bun.spawnSync(["ps", "-p", String(proc.pid), "-o", "args="]);
			const args = ps.stdout.toString();
			expect(args).toContain("postgres://sl@db:5432/sl");
			expect(args).not.toContain("S3cret");
		} finally {
			proc.kill();
			await proc.exited;
		}
	});
});

describe("subscription scaffold .env is owner-only", () => {
	const mode = (path: string) => statSync(path).mode & 0o777;

	it("a fresh .env is written with mode 0600", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-env-"));
		try {
			const target = writeSigningSecretEnv(dir, "whsec_x");
			expect(mode(target)).toBe(0o600);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("a .env seeded from a world-readable .env.example is chmodded to 0600", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-env-"));
		try {
			await writeFile(join(dir, ".env.example"), "PORT=3000\n", {
				mode: 0o644,
			});
			const target = writeSigningSecretEnv(dir, "whsec_x");
			expect(mode(target)).toBe(0o600);
			expect(await readFile(target, "utf8")).toContain(
				"SIGNING_SECRET=whsec_x",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("an existing loose .env is tightened when the secret is rewritten", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-env-"));
		try {
			await writeFile(join(dir, ".env"), "SIGNING_SECRET=old\n", {
				mode: 0o644,
			});
			const target = writeSigningSecretEnv(dir, "whsec_new");
			expect(mode(target)).toBe(0o600);
			expect(await readFile(target, "utf8")).toBe("SIGNING_SECRET=whsec_new\n");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
