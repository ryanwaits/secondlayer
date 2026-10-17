import { describe, expect, test } from "bun:test";
import { CliHttpError } from "../lib/http.ts";
import { browserCommand } from "../lib/open-browser.ts";
import {
	type LoginCheckDeps,
	pollDeviceToken,
	shouldContinueLogin,
} from "./login.ts";

const START = { deviceCode: "dc", interval: 5, expiresIn: 900 };

function fakeDeps(
	replies: Array<() => unknown>,
	clock = { t: 0 },
): Parameters<typeof pollDeviceToken>[1] & { slept: number[] } {
	const slept: number[] = [];
	let i = 0;
	return {
		slept,
		sleep: async (ms) => {
			slept.push(ms);
			clock.t += ms;
		},
		now: () => clock.t,
		post: (async () => {
			const reply = replies[Math.min(i++, replies.length - 1)];
			return reply();
		}) as never,
	};
}

const pending = () => {
	throw new CliHttpError(
		428,
		"HTTP_428",
		{ error: "authorization_pending" },
		"authorization_pending",
	);
};

describe("pollDeviceToken", () => {
	test("waits through pending, then returns the session token", async () => {
		const account = { id: "a1", email: "ryan@example.com" };
		const deps = fakeDeps([
			pending,
			pending,
			() => ({ sessionToken: "ss-sl_x", account }),
		]);
		const out = await pollDeviceToken(START, deps);
		expect(out).toEqual({
			kind: "approved",
			sessionToken: "ss-sl_x",
			account,
		});
		expect(deps.slept).toEqual([5000, 5000, 5000]);
	});

	test("denied in the browser", async () => {
		const out = await pollDeviceToken(
			START,
			fakeDeps([
				() => {
					throw new CliHttpError(
						403,
						"HTTP_403",
						{ error: "access_denied" },
						"access_denied",
					);
				},
			]),
		);
		expect(out).toEqual({ kind: "denied" });
	});

	test("410 means the code expired", async () => {
		const out = await pollDeviceToken(
			START,
			fakeDeps([
				() => {
					throw new CliHttpError(
						410,
						"HTTP_410",
						{ error: "expired_token" },
						"expired_token",
					);
				},
			]),
		);
		expect(out).toEqual({ kind: "expired" });
	});

	test("gives up as expired when the clock runs out", async () => {
		const out = await pollDeviceToken(
			{ ...START, expiresIn: 12 },
			fakeDeps([pending]),
		);
		expect(out).toEqual({ kind: "expired" });
	});

	test("a key-limit refusal surfaces its message", async () => {
		await expect(
			pollDeviceToken(
				START,
				fakeDeps([
					() => {
						throw new CliHttpError(
							403,
							"AUTHORIZATION_ERROR",
							{ error: "Account has reached the active API-key limit (50)." },
							"Account has reached the active API-key limit (50).",
						);
					},
				]),
			),
		).rejects.toThrow("API-key limit");
	});

	test("retries a flaky network, then fails", async () => {
		const flaky = () => {
			throw new Error("fetch failed");
		};
		const ok = fakeDeps([
			flaky,
			flaky,
			() => ({ sessionToken: "s", account: { id: "a", email: "e" } }),
		]);
		expect((await pollDeviceToken(START, ok)).kind).toBe("approved");
		await expect(pollDeviceToken(START, fakeDeps([flaky]))).rejects.toThrow(
			"fetch failed",
		);
	});
});

describe("browserCommand", () => {
	test("picks the opener for each platform", () => {
		const url = "https://secondlayer.tools/cli/login?code=WDJB-MJHT";
		expect(browserCommand(url, "darwin").cmd).toBe("open");
		expect(browserCommand(url, "linux").cmd).toBe("xdg-open");
		expect(browserCommand(url, "win32").cmd).toBe("cmd");
	});
});

describe("shouldContinueLogin", () => {
	const saved = {
		token: "sk-sl_x",
		email: "a@b.co",
		accountId: "00000000-0000-0000-0000-000000000000",
		expiresAt: "2030-01-01T00:00:00.000Z",
	};
	const revoked = (status: number) => () => {
		throw new CliHttpError(
			status,
			"KEY_REVOKED",
			{ error: "API key has been revoked" },
			"API key has been revoked",
		);
	};

	function deps(
		session: typeof saved | null,
		verify: () => unknown,
	): LoginCheckDeps & { verified: number } {
		const d = {
			verified: 0,
			readSession: (async () => session) as never,
			verify: async () => {
				d.verified++;
				return verify();
			},
		};
		return d;
	}

	async function noTty<T>(fn: () => Promise<T>): Promise<T> {
		const original = process.stdin.isTTY;
		process.stdin.isTTY = false;
		try {
			return await fn();
		} finally {
			process.stdin.isTTY = original;
		}
	}

	test("no saved login continues without calling the server", async () => {
		const d = deps(null, () => ({}));
		expect(await shouldContinueLogin("https://x", {}, d)).toBe(true);
		expect(d.verified).toBe(0);
	});

	test("--force continues without calling the server", async () => {
		const d = deps(saved, () => ({}));
		expect(await shouldContinueLogin("https://x", { force: true }, d)).toBe(
			true,
		);
		expect(d.verified).toBe(0);
	});

	test("a revoked saved login (401) signs in again", async () => {
		const d = deps(saved, revoked(401));
		expect(await shouldContinueLogin("https://x", {}, d)).toBe(true);
	});

	test("a forbidden saved login (403) signs in again", async () => {
		const d = deps(saved, revoked(403));
		expect(await shouldContinueLogin("https://x", {}, d)).toBe(true);
	});

	test("a working saved login stops without a TTY", async () => {
		const d = deps(saved, () => ({}));
		expect(await noTty(() => shouldContinueLogin("https://x", {}, d))).toBe(
			false,
		);
	});

	test("an unreachable server keeps the saved login", async () => {
		const d = deps(saved, () => {
			throw new Error("fetch failed");
		});
		expect(await noTty(() => shouldContinueLogin("https://x", {}, d))).toBe(
			false,
		);
	});
});
