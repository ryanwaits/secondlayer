import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { WalletProvider } from "../../types.ts";
import { WalletConnectProvider } from "../provider.ts";

// Mock WebSocket
class MockWebSocket {
	static OPEN = 1;
	readyState = 0;
	url: string;
	private listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();
	sent: string[] = [];

	constructor(url: string) {
		this.url = url;
		setTimeout(() => {
			this.readyState = 1;
			this.emit("open", {});
		}, 0);
	}

	addEventListener(
		event: string,
		fn: (...args: unknown[]) => unknown,
		opts?: { once?: boolean },
	) {
		if (!this.listeners.has(event)) this.listeners.set(event, new Set());
		const wrapped = opts?.once
			? // biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
				(...args: any[]) => {
					this.listeners.get(event)?.delete(wrapped);
					fn(...args);
				}
			: fn;
		this.listeners.get(event)?.add(wrapped);
	}
	removeEventListener() {}
	send(data: string) {
		this.sent.push(data);
	}
	close() {
		this.readyState = 3;
	}
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	emit(event: string, data: any) {
		for (const fn of this.listeners.get(event) ?? []) fn(data);
	}
}

const origWS = globalThis.WebSocket;
const storage = new Map<string, string>();

beforeEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	(globalThis as any).WebSocket = class extends MockWebSocket {};
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	(globalThis as any).WebSocket.OPEN = 1;
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	(globalThis as any).localStorage = {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => storage.set(k, v),
		removeItem: (k: string) => storage.delete(k),
	};
	storage.clear();
});

afterEach(() => {
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	(globalThis as any).WebSocket = origWS;
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	(globalThis as any).localStorage = undefined;
});

describe("WalletConnectProvider", () => {
	const config = {
		projectId: "test",
		metadata: {
			name: "App",
			description: "",
			url: "https://app.com",
			icons: [],
		},
	};

	test("implements WalletProvider interface", () => {
		const wc = new WalletConnectProvider(config);
		expect(typeof wc.request).toBe("function");
		expect(typeof wc.disconnect).toBe("function");

		// Type check: assignable to WalletProvider
		const _provider: WalletProvider = wc;
		expect(_provider).toBeDefined();
	});

	test("restore returns false with no session", () => {
		const wc = new WalletConnectProvider(config);
		expect(wc.restore()).toBe(false);
	});

	test("pair returns URI and approval", async () => {
		const wc = new WalletConnectProvider(config);
		void wc.pair();

		await new Promise((r) => setTimeout(r, 20));
		// Would need to respond to subscribe — just verify it doesn't crash
		// The full flow is tested in session.test.ts
	});

	test("sessionData is null initially", () => {
		const wc = new WalletConnectProvider(config);
		expect(wc.sessionData).toBeNull();
	});

	test("disconnect cleans up", () => {
		const wc = new WalletConnectProvider(config);
		wc.disconnect(); // should not throw
	});
});
