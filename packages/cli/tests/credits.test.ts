import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ARCHIVE_LOGIN_COMMAND,
	CliHttpError,
	httpArchiveOps,
	resolveArchiveOpsBearer,
} from "../src/lib/http";

/**
 * The archive credits merchant validates `ss-sl_` sessions and `sk-sl_` API
 * keys. A self-hoster exports INSTANCE_TOKEN for their own box; that hex
 * must never be sent to the merchant, and it must never hide the login the
 * operator already did.
 */

const ENV = ["INSTANCE_TOKEN", "SL_API_KEY", "SL_CREDITS_API_URL", "HOME"];
const SESSION = {
	token: "ss-sl_valid",
	email: "a@b.co",
	accountId: "00000000-0000-4000-8000-000000000000",
	expiresAt: new Date(Date.now() + 1e9).toISOString(),
};

let server: ReturnType<typeof Bun.serve>;
let seenBearers: string[] = [];
let home: string;
let saved: Record<string, string | undefined> = {};

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const raw = (req.headers.get("authorization") ?? "").replace(
				/^Bearer /,
				"",
			);
			seenBearers.push(raw);
			if (!/^s[ks]-sl_/.test(raw) || raw === "ss-sl_revoked") {
				return Response.json(
					{ error: "Invalid token format" },
					{ status: 401 },
				);
			}
			return Response.json({ creditsUsdMicros: "1000000" });
		},
	});
});

afterAll(() => {
	server.stop(true);
});

beforeEach(async () => {
	saved = {};
	for (const k of ENV) saved[k] = process.env[k];
	for (const k of ["INSTANCE_TOKEN", "SL_API_KEY"]) {
		Reflect.deleteProperty(process.env, k);
	}
	home = await mkdtemp(join(tmpdir(), "sl-credits-home-"));
	process.env.HOME = home;
	process.env.SL_CREDITS_API_URL = `http://127.0.0.1:${server.port}`;
	seenBearers = [];
});

afterEach(async () => {
	for (const k of ENV) {
		if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = saved[k];
	}
	await rm(home, { recursive: true, force: true });
});

async function writeCreditsSession(): Promise<void> {
	await mkdir(join(home, ".secondlayer"), { recursive: true });
	await writeFile(
		join(home, ".secondlayer", "session.json"),
		JSON.stringify({
			sessions: { [`http://127.0.0.1:${server.port}`]: SESSION },
		}),
	);
}

describe("archive credits bearer", () => {
	it("sends the credits session even when INSTANCE_TOKEN is exported", async () => {
		await writeCreditsSession();
		process.env.INSTANCE_TOKEN = "a".repeat(64);
		const res = await httpArchiveOps<{ creditsUsdMicros: string }>(
			"/api/billing/status",
		);
		expect(res.creditsUsdMicros).toBe("1000000");
		expect(seenBearers).toEqual(["ss-sl_valid"]);
	});

	it("uses an sk-sl_ env key when there is no session", async () => {
		process.env.SL_API_KEY = "sk-sl_ci_key";
		await httpArchiveOps("/api/billing/status");
		expect(seenBearers).toEqual(["sk-sl_ci_key"]);
		expect((await resolveArchiveOpsBearer()).source).toBe("env");
	});

	it("prefers the session over an sk-sl_ env key", async () => {
		await writeCreditsSession();
		process.env.SL_API_KEY = "sk-sl_ci_key";
		await httpArchiveOps("/api/billing/status");
		expect(seenBearers).toEqual(["ss-sl_valid"]);
	});

	it("never sends a bare instance token off the box; the error names the login and the ignored key", async () => {
		process.env.INSTANCE_TOKEN = "a".repeat(64);
		let err: unknown;
		try {
			await httpArchiveOps("/api/billing/status");
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(CliHttpError);
		expect((err as CliHttpError).status).toBe(401);
		expect((err as CliHttpError).message).toContain(ARCHIVE_LOGIN_COMMAND);
		expect((err as CliHttpError).message).toContain(
			"INSTANCE_TOKEN was ignored",
		);
		expect(seenBearers).toEqual([]);
	});

	it("with nothing set the error names the login and no ignored key", async () => {
		let message = "";
		try {
			await httpArchiveOps("/api/billing/status");
		} catch (e) {
			message = (e as Error).message;
		}
		expect(message).toContain(ARCHIVE_LOGIN_COMMAND);
		expect(message).not.toContain("ignored");
	});

	it("a merchant 401 on a stored session is answered with the login remedy", async () => {
		await mkdir(join(home, ".secondlayer"), { recursive: true });
		await writeFile(
			join(home, ".secondlayer", "session.json"),
			JSON.stringify({
				sessions: {
					[`http://127.0.0.1:${server.port}`]: {
						...SESSION,
						token: "ss-sl_revoked",
					},
				},
			}),
		);
		let err: unknown;
		try {
			await httpArchiveOps("/api/billing/status");
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(CliHttpError);
		expect((err as CliHttpError).status).toBe(401);
		expect((err as CliHttpError).message).toContain("Invalid token format");
		expect((err as CliHttpError).message).toContain(ARCHIVE_LOGIN_COMMAND);
	});
});
