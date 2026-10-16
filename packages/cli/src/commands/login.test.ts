import { describe, expect, test } from "bun:test";
import { CliHttpError } from "../lib/http.ts";
import { browserCommand } from "../lib/open-browser.ts";
import { pollDeviceToken } from "./login.ts";

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
