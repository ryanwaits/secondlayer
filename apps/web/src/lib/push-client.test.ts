import { describe, expect, test } from "bun:test";
import { type PushEnv, pushState, urlBase64ToUint8Array } from "./push-client";

const base: PushEnv = {
	hasServiceWorker: true,
	hasPushManager: true,
	isIos: false,
	standalone: false,
	permission: "default",
	subscribed: false,
	publicKey: "key",
};
const state = (over: Partial<PushEnv>) => pushState({ ...base, ...over });

describe("pushState", () => {
	test("a browser without push is unsupported", () => {
		expect(state({ hasPushManager: false })).toBe("unsupported");
		expect(state({ hasServiceWorker: false })).toBe("unsupported");
		expect(state({ permission: null })).toBe("unsupported");
	});
	test("iOS outside the home-screen app needs the install first", () => {
		expect(
			state({ isIos: true, hasPushManager: false, permission: null }),
		).toBe("needs_install");
	});
	test("iOS in the installed app is judged like any browser", () => {
		expect(state({ isIos: true, standalone: true })).toBe("off");
	});
	test("a server without a key is unavailable", () => {
		expect(state({ publicKey: null })).toBe("unavailable");
	});
	test("a denied permission is blocked", () => {
		expect(state({ permission: "denied" })).toBe("blocked");
	});
	test("supported and not subscribed is off", () => {
		expect(state({})).toBe("off");
	});
	test("subscribed with permission is on", () => {
		expect(state({ subscribed: true, permission: "granted" })).toBe("on");
	});
	test("a subscription without permission is off", () => {
		expect(state({ subscribed: true, permission: "default" })).toBe("off");
	});
});

describe("urlBase64ToUint8Array", () => {
	test("decodes url-safe base64 without padding", () => {
		expect(Array.from(urlBase64ToUint8Array("SGVsbG8"))).toEqual([
			72, 101, 108, 108, 111,
		]);
	});
	test("maps - and _ to + and /", () => {
		expect(Array.from(urlBase64ToUint8Array("-_-_"))).toEqual([251, 255, 191]);
	});
});
