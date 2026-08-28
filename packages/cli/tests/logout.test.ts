import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLogout } from "../src/commands/logout";
import { ARCHIVE_OPS_API_URL, LOCAL_API_URL } from "../src/lib/api-url";
import { readSession, writeSession } from "../src/lib/session";

/**
 * Sessions are stored one per API URL. `logout --credits` must revoke and
 * drop the credits slot and leave the instance slot alone, and vice versa.
 */

const ENV = ["SL_API_URL", "SL_PLATFORM_API_URL", "SL_CREDITS_API_URL", "HOME"];
const session = (token: string) => ({
	token,
	email: "a@b.co",
	accountId: "00000000-0000-4000-8000-000000000000",
	expiresAt: new Date(Date.now() + 1e9).toISOString(),
});

let home: string;
let saved: Record<string, string | undefined> = {};
let server: ReturnType<typeof Bun.serve>;
let revoked: string[] = [];

beforeEach(async () => {
	saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
	for (const k of ENV) Reflect.deleteProperty(process.env, k);
	home = await mkdtemp(join(tmpdir(), "sl-logout-"));
	process.env.HOME = home;
	revoked = [];
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/api/auth/logout" && req.method === "POST") {
				revoked.push(
					(req.headers.get("authorization") ?? "").replace(/^Bearer /, ""),
				);
				return Response.json({ ok: true });
			}
			return Response.json({ error: "nope" }, { status: 404 });
		},
	});
	process.env.SL_CREDITS_API_URL = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
	server.stop(true);
	await rm(home, { recursive: true, force: true });
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	}
});

describe("logout", () => {
	it("--credits revokes the credits session on the merchant and keeps the instance login", async () => {
		const creditsUrl = process.env.SL_CREDITS_API_URL as string;
		await writeSession(session("ss-sl_credits"), creditsUrl);
		await writeSession(session("ss-sl_instance"), LOCAL_API_URL);

		await runLogout({ credits: true });

		expect(revoked).toEqual(["ss-sl_credits"]);
		expect(await readSession(creditsUrl)).toBeNull();
		expect((await readSession(LOCAL_API_URL))?.token).toBe("ss-sl_instance");
	});

	it("without --credits only touches the instance slot, so a credits login survives", async () => {
		const creditsUrl = process.env.SL_CREDITS_API_URL as string;
		await writeSession(session("ss-sl_credits"), creditsUrl);
		await writeSession(session("ss-sl_instance"), LOCAL_API_URL);

		await runLogout();

		expect(revoked).toEqual([]);
		expect(await readSession(LOCAL_API_URL)).toBeNull();
		expect((await readSession(creditsUrl))?.token).toBe("ss-sl_credits");
	});

	it("--credits clears the slot locally even when the merchant refuses the revoke", async () => {
		server.stop(true);
		server = Bun.serve({
			port: 0,
			fetch: () => Response.json({ error: "down" }, { status: 503 }),
		});
		process.env.SL_CREDITS_API_URL = `http://127.0.0.1:${server.port}`;
		const creditsUrl = process.env.SL_CREDITS_API_URL;
		await writeSession(session("ss-sl_credits"), creditsUrl);

		await runLogout({ credits: true });

		expect(await readSession(creditsUrl)).toBeNull();
	});

	it("an old flat session file is read as the credits login, so logout --credits clears it", async () => {
		const { writeFile, mkdir } = await import("node:fs/promises");
		await mkdir(join(home, ".secondlayer"), { recursive: true });
		await writeFile(
			join(home, ".secondlayer", "session.json"),
			JSON.stringify(session("ss-sl_legacy")),
		);
		Reflect.deleteProperty(process.env, "SL_CREDITS_API_URL");
		expect((await readSession(ARCHIVE_OPS_API_URL))?.token).toBe(
			"ss-sl_legacy",
		);
		expect(await readSession(LOCAL_API_URL)).toBeNull();
	});
});
