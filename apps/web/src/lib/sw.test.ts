import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
	join(import.meta.dir, "../../public/sw.js"),
	"utf8",
);

type Listener = (event: unknown) => void;
type Shown = {
	title: string;
	options: { tag?: string; data: { url: string } };
};

/** Runs sw.js against a fake worker scope and returns what it did. */
function load(openClients: { url: string }[] = []) {
	const listeners: Record<string, Listener> = {};
	const shown: Shown[] = [];
	const calls: string[] = [];
	const clients = openClients.map((c) => ({
		url: c.url,
		navigate: async (url: string) => {
			calls.push(`navigate ${url}`);
		},
		focus: async () => {
			calls.push("focus");
		},
	}));
	const self = {
		addEventListener: (type: string, fn: Listener) => {
			listeners[type] = fn;
		},
		registration: {
			showNotification: async (title: string, options: Shown["options"]) => {
				shown.push({ title, options });
			},
		},
		clients: {
			matchAll: async () => clients,
			openWindow: async (url: string) => {
				calls.push(`open ${url}`);
			},
		},
	};
	new Function("self", SOURCE)(self);

	const waits: Promise<unknown>[] = [];
	const waitUntil = (p: Promise<unknown>) => waits.push(p);
	return {
		shown,
		calls,
		push: async (data: unknown) => {
			listeners.push?.({ data: { json: () => data }, waitUntil });
			await Promise.all(waits);
		},
		click: async (url?: string) => {
			listeners.notificationclick?.({
				notification: { close: () => {}, data: url ? { url } : undefined },
				waitUntil,
			});
			await Promise.all(waits);
		},
		listeners,
	};
}

describe("service worker", () => {
	test("a push shows its title and tag and keeps a same-origin link", async () => {
		const sw = load();
		await sw.push({
			title: "A webhook is failing",
			body: "orders stopped answering",
			url: "/account/webhooks/wh_1",
			tag: "webhook-wh_1",
		});
		expect(sw.shown).toHaveLength(1);
		expect(sw.shown[0]?.title).toBe("A webhook is failing");
		expect(sw.shown[0]?.options.tag).toBe("webhook-wh_1");
		expect(sw.shown[0]?.options.data.url).toBe("/account/webhooks/wh_1");
	});

	test("a link to another origin falls back to the account", async () => {
		const sw = load();
		await sw.push({ title: "x", url: "https://evil.example" });
		await sw.push({ title: "y", url: "//evil.example/x" });
		expect(sw.shown.map((s) => s.options.data.url)).toEqual([
			"/account",
			"/account",
		]);
	});

	test("a click with the app open navigates and focuses it", async () => {
		const sw = load([{ url: "https://www.secondlayer.tools/account/keys" }]);
		await sw.click("/account/webhooks/wh_1");
		expect(sw.calls).toEqual(["navigate /account/webhooks/wh_1", "focus"]);
	});

	test("a click with no app open opens a window", async () => {
		const sw = load([{ url: "https://www.secondlayer.tools/docs" }]);
		await sw.click("/account/webhooks/wh_1");
		expect(sw.calls).toEqual(["open /account/webhooks/wh_1"]);
	});

	test("it never intercepts fetches", () => {
		expect(Object.keys(load().listeners).sort()).toEqual([
			"notificationclick",
			"push",
		]);
	});
});
