import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	capture,
	identify,
	isFeatureEnabled,
	loadAnalytics,
	onFeatureFlags,
	reset,
	resetAnalytics,
} from "./analytics";

type Call = [string, ...unknown[]];

function fakeClient(calls: Call[], flagHandlers: Array<() => void> = []) {
	return {
		init: (...args: unknown[]) => calls.push(["init", ...args]),
		identify: (...args: unknown[]) => calls.push(["identify", ...args]),
		reset: () => calls.push(["reset"]),
		capture: (...args: unknown[]) => calls.push(["capture", ...args]),
		onFeatureFlags: (cb: () => void) => {
			calls.push(["onFeatureFlags"]);
			flagHandlers.push(cb);
			return () => calls.push(["unsubscribe"]);
		},
		isFeatureEnabled: (flag: string) => flag === "on",
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const env = process.env;
let saved: { token?: string; host?: string };

beforeEach(() => {
	saved = {
		token: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
		host: env.NEXT_PUBLIC_POSTHOG_HOST,
	};
	env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
	env.NEXT_PUBLIC_POSTHOG_HOST = "/ingest";
	resetAnalytics();
});

afterEach(() => {
	if (saved.token === undefined) delete env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
	else env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = saved.token;
	if (saved.host === undefined) delete env.NEXT_PUBLIC_POSTHOG_HOST;
	else env.NEXT_PUBLIC_POSTHOG_HOST = saved.host;
	resetAnalytics();
});

describe("analytics facade", () => {
	test("calls made before load are queued and replayed in order", async () => {
		const calls: Call[] = [];
		const fake = fakeClient(calls);
		capture("a", { n: 1 });
		identify("acct", { email: "x" });
		reset();
		expect(calls).toEqual([]);

		loadAnalytics((async () => ({ default: fake })) as never);
		await settle();

		expect(calls.map((c) => c[0])).toEqual([
			"init",
			"capture",
			"identify",
			"reset",
		]);
	});

	test("calls after load go straight through", async () => {
		const calls: Call[] = [];
		loadAnalytics((async () => ({ default: fakeClient(calls) })) as never);
		await settle();
		calls.length = 0;
		capture("b");
		expect(calls).toEqual([["capture", "b", undefined]]);
	});

	test("unsubscribing before load means the callback never subscribes", async () => {
		const calls: Call[] = [];
		const unsubscribe = onFeatureFlags(() => {});
		unsubscribe();
		loadAnalytics((async () => ({ default: fakeClient(calls) })) as never);
		await settle();
		expect(calls.some((c) => c[0] === "onFeatureFlags")).toBe(false);
	});

	test("unsubscribing after load calls the real unsubscribe", async () => {
		const calls: Call[] = [];
		const unsubscribe = onFeatureFlags(() => {});
		loadAnalytics((async () => ({ default: fakeClient(calls) })) as never);
		await settle();
		unsubscribe();
		expect(calls.map((c) => c[0])).toEqual([
			"init",
			"onFeatureFlags",
			"unsubscribe",
		]);
	});

	test("isFeatureEnabled is undefined before load and delegates after", async () => {
		expect(isFeatureEnabled("on")).toBeUndefined();
		loadAnalytics((async () => ({ default: fakeClient([]) })) as never);
		await settle();
		expect(isFeatureEnabled("on")).toBe(true);
	});

	test("loading twice imports once", async () => {
		let imports = 0;
		const importer = async () => {
			imports++;
			return { default: fakeClient([]) };
		};
		loadAnalytics(importer as never);
		loadAnalytics(importer as never);
		await settle();
		expect(imports).toBe(1);
	});

	test("missing env neither throws nor imports", async () => {
		delete env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
		let imports = 0;
		expect(() =>
			loadAnalytics((async () => {
				imports++;
				return { default: fakeClient([]) };
			}) as never),
		).not.toThrow();
		await settle();
		expect(imports).toBe(0);
	});
});
