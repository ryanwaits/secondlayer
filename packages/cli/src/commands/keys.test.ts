import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import type { Session } from "../lib/session.ts";
import {
	type ListedKey,
	applyRotationToLogin,
	registerKeysCommand,
	resolveKeyRef,
	rotatableKeys,
	saveRotatedLogin,
} from "./keys.ts";

function key(overrides: Partial<ListedKey> & { id: string }): ListedKey {
	return {
		prefix: "sk-sl_aaaa1111",
		name: "ci",
		status: "active",
		product: "account",
		tier: "free",
		createdAt: "2026-11-01T00:00:00.000Z",
		lastUsedAt: null,
		expiresAt: null,
		rowsDaily: [],
		rows30d: 0,
		...overrides,
	};
}

const CI = key({
	id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	prefix: "sk-sl_ci000001",
	name: "ci",
});
const LAPTOP = key({
	id: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	prefix: "sk-sl_lp000002",
	name: "laptop",
});

describe("secondlayer keys", () => {
	test("registers list and rotate with their flags", () => {
		const program = new Command();
		registerKeysCommand(program);
		const keys = program.commands.find((c) => c.name() === "keys");
		const names = (keys?.commands ?? []).map((c) => c.name());
		expect(names).toEqual(["list", "rotate"]);

		const flags = (name: string) =>
			keys?.commands.find((c) => c.name() === name)?.options.map((o) => o.long);
		expect(flags("rotate")).toContain("--yes");
		expect(flags("rotate")).toContain("--json");
		expect(flags("list")).toEqual(["--json"]);
	});
});

describe("rotatableKeys", () => {
	test("drops revoked, docs, tenant and sentinel keys", () => {
		const rows = [
			CI,
			key({ id: "r", status: "revoked" }),
			key({ id: "d", product: "docs" }),
			key({ id: "t", product: "tenant" }),
			key({ id: "s", product: "sentinel" }),
		];
		expect(rotatableKeys(rows)).toEqual([CI]);
	});
});

describe("resolveKeyRef", () => {
	const rows = [CI, LAPTOP];

	test("matches a full id", () => {
		expect(resolveKeyRef(rows, LAPTOP.id)).toBe(LAPTOP);
	});

	test("matches the first 8 characters of an id", () => {
		expect(resolveKeyRef(rows, "22222222")).toBe(LAPTOP);
	});

	test("does not match an id on 7 characters", () => {
		expect(() => resolveKeyRef(rows, "2222222")).toThrow(
			"secondlayer keys list",
		);
	});

	test("matches a prefix with and without the ellipsis", () => {
		expect(resolveKeyRef(rows, "sk-sl_ci000001")).toBe(CI);
		expect(resolveKeyRef(rows, "sk-sl_ci000001…")).toBe(CI);
	});

	test("matches a unique name", () => {
		expect(resolveKeyRef(rows, "laptop")).toBe(LAPTOP);
	});

	test("a duplicate name errors and lists both keys", () => {
		const twin = key({
			id: "33333333-cccc-4ccc-8ccc-cccccccccccc",
			prefix: "sk-sl_ci000003",
			name: "ci",
		});
		let message = "";
		try {
			resolveKeyRef([CI, twin], "ci");
		} catch (err) {
			message = (err as Error).message;
		}
		expect(message).toContain('"ci" matches 2 keys');
		expect(message).toContain("11111111 ci");
		expect(message).toContain("33333333 ci");
		expect(message).toContain("Use an id.");
	});

	test("a revoked key's name does not match", () => {
		const revoked = key({ id: "r".repeat(36), name: "old", status: "revoked" });
		expect(() => resolveKeyRef([CI, revoked], "old")).toThrow(
			'No active account key matches "old". Run: secondlayer keys list',
		);
	});

	test("no match points at keys list", () => {
		expect(() => resolveKeyRef(rows, "nope")).toThrow(
			'No active account key matches "nope". Run: secondlayer keys list',
		);
	});
});

describe("applyRotationToLogin", () => {
	const API_URL = "https://api.example.test";
	const PREFIX = "sk-sl_ci000001";
	const NEW_KEY = "sk-sl_ci000001NEW";

	function session(token: string): Session {
		return {
			token,
			email: "dev@example.com",
			accountId: "44444444-dddd-4ddd-8ddd-dddddddddddd",
			expiresAt: "2027-01-01T00:00:00.000Z",
		};
	}

	function harness(stored: Session | null, envKey?: string) {
		const writes: { session: Session; apiUrl: string }[] = [];
		const deps = {
			apiUrl: API_URL,
			readSession: async () => stored,
			writeSession: async (s: Session, apiUrl: string) => {
				writes.push({ session: s, apiUrl });
			},
			envKey,
		};
		return { deps, writes };
	}

	test("replaces a stored key token and keeps the rest of the session", async () => {
		const stored = session(`${PREFIX}OLD`);
		const { deps, writes } = harness(stored);
		const result = await applyRotationToLogin(PREFIX, NEW_KEY, deps);
		expect(result).toEqual({ loginUpdated: true, envStale: false });
		expect(writes).toEqual([
			{ session: { ...stored, token: NEW_KEY }, apiUrl: API_URL },
		]);
	});

	test("leaves a browser login token alone", async () => {
		const { deps, writes } = harness(session("ss-sl_browser"));
		const result = await applyRotationToLogin(PREFIX, NEW_KEY, deps);
		expect(result).toEqual({ loginUpdated: false, envStale: false });
		expect(writes).toEqual([]);
	});

	test("leaves another key's token alone", async () => {
		const { deps, writes } = harness(session("sk-sl_lp000002xyz"));
		const result = await applyRotationToLogin(PREFIX, NEW_KEY, deps);
		expect(result).toEqual({ loginUpdated: false, envStale: false });
		expect(writes).toEqual([]);
	});

	test("flags a matching env key as stale and writes nothing", async () => {
		const { deps, writes } = harness(null, `${PREFIX}OLD`);
		const result = await applyRotationToLogin(PREFIX, NEW_KEY, deps);
		expect(result).toEqual({ loginUpdated: false, envStale: true });
		expect(writes).toEqual([]);
	});

	test("reports nothing when there is no session and no env key", async () => {
		const { deps, writes } = harness(null, undefined);
		const result = await applyRotationToLogin(PREFIX, NEW_KEY, deps);
		expect(result).toEqual({ loginUpdated: false, envStale: false });
		expect(writes).toEqual([]);
	});

	test("saveRotatedLogin reports a failed login write instead of throwing", async () => {
		const stored = session(`${PREFIX}OLD`);
		const { deps } = harness(stored, `${PREFIX}OLD`);
		const result = await saveRotatedLogin(PREFIX, NEW_KEY, {
			...deps,
			writeSession: async () => {
				throw new Error("EACCES: permission denied");
			},
		});
		expect(result).toEqual({
			loginUpdated: false,
			envStale: true,
			loginError: "EACCES: permission denied",
		});
	});

	test("saveRotatedLogin passes a successful update through", async () => {
		const { deps } = harness(session(`${PREFIX}OLD`));
		const result = await saveRotatedLogin(PREFIX, NEW_KEY, deps);
		expect(result).toEqual({ loginUpdated: true, envStale: false });
	});
});
