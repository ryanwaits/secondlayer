import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import type { Session } from "../lib/session.ts";
import {
	type KeysDeps,
	type ListedKey,
	applyRotationToLogin,
	keyInUse,
	registerKeysCommand,
	resolveKeyRef,
	rotatableKeys,
	runCreate,
	runRevoke,
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
	test("registers list, create, rotate and revoke with their flags", () => {
		const program = new Command();
		registerKeysCommand(program);
		const keys = program.commands.find((c) => c.name() === "keys");
		const names = (keys?.commands ?? []).map((c) => c.name());
		expect(names).toEqual(["list", "create", "rotate", "revoke"]);

		const flags = (name: string) =>
			keys?.commands.find((c) => c.name() === name)?.options.map((o) => o.long);
		expect(flags("rotate")).toContain("--yes");
		expect(flags("rotate")).toContain("--json");
		expect(flags("list")).toEqual(["--json"]);
		expect(flags("create")).toEqual(["--name", "--json"]);
		expect(flags("revoke")).toEqual(["--yes", "--json"]);
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

const API_URL = "https://api.example.test";
const SESSION_BASE = {
	email: "dev@example.com",
	accountId: "44444444-dddd-4ddd-8ddd-dddddddddddd",
	expiresAt: "2027-01-01T00:00:00.000Z",
};

type Call = { path: string; method: string; body: unknown };

function fakeDeps(opts: {
	token?: string;
	envKey?: string;
	keys?: ListedKey[];
}): { deps: KeysDeps; calls: Call[] } {
	const calls: Call[] = [];
	const deps: KeysDeps = {
		http: async <T>(
			path: string,
			init?: { method?: string; body?: unknown },
		): Promise<T> => {
			const method = init?.method ?? "GET";
			calls.push({ path, method, body: init?.body });
			if (method === "GET") return { keys: opts.keys ?? [CI, LAPTOP] } as T;
			if (method === "POST") {
				return {
					key: "sk-sl_new00001SECRETSECRETSECRET00",
					prefix: "sk-sl_new00001",
					id: "55555555-eeee-4eee-8eee-eeeeeeeeeeee",
					product: "account",
					tier: "free",
					createdAt: "2026-11-23T00:00:00.000Z",
				} as T;
			}
			const id = path.split("/").pop();
			return { revoked: true, id } as T;
		},
		login: {
			apiUrl: API_URL,
			readSession: async () =>
				opts.token ? { ...SESSION_BASE, token: opts.token } : null,
			writeSession: async () => {},
			envKey: opts.envKey,
		},
	};
	return { deps, calls };
}

function capture() {
	const out: string[] = [];
	const err: string[] = [];
	const stdout = spyOn(process.stdout, "write").mockImplementation(((
		chunk: string,
	) => {
		out.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
	const stderr = spyOn(console, "error").mockImplementation(
		(...args: unknown[]) => {
			err.push(args.map(String).join(" "));
		},
	);
	return {
		stdout: () => out.join(""),
		stderr: () => err.join("\n"),
		restore: () => {
			stdout.mockRestore();
			stderr.mockRestore();
		},
	};
}

describe("runCreate", () => {
	let io: ReturnType<typeof capture>;
	beforeEach(() => {
		io = capture();
	});
	afterEach(() => io.restore());

	test("posts the name and prints the secret once", async () => {
		const { deps, calls } = fakeDeps({});
		await runCreate({ name: "ci" }, deps);
		expect(calls).toEqual([
			{ path: "/api/keys", method: "POST", body: { name: "ci" } },
		]);
		expect(io.stdout()).toBe("sk-sl_new00001SECRETSECRETSECRET00\n");
		expect(io.stderr()).toContain("Created ci (sk-sl_new00001…).");
		expect(io.stderr()).toContain("Shown once. Copy it now.");
	});

	test("sends an empty body without --name", async () => {
		const { deps, calls } = fakeDeps({});
		await runCreate({}, deps);
		expect(calls[0]?.body).toEqual({});
		expect(io.stderr()).toContain("Created (unnamed)");
	});

	test("--json prints the response body", async () => {
		const { deps } = fakeDeps({});
		await runCreate({ name: "ci", json: true }, deps);
		const body = JSON.parse(io.stdout());
		expect(body.key).toBe("sk-sl_new00001SECRETSECRETSECRET00");
		expect(body.prefix).toBe("sk-sl_new00001");
		expect(io.stderr()).toBe("");
	});
});

describe("runRevoke", () => {
	let io: ReturnType<typeof capture>;
	beforeEach(() => {
		io = capture();
	});
	afterEach(() => io.restore());

	for (const ref of [CI.id, "11111111", "sk-sl_ci000001", "ci"]) {
		test(`-y revokes the key matched by "${ref}"`, async () => {
			const { deps, calls } = fakeDeps({});
			await runRevoke(ref, { yes: true }, deps);
			expect(calls.at(-1)).toEqual({
				path: `/api/keys/${CI.id}`,
				method: "DELETE",
				body: undefined,
			});
			expect(io.stderr()).toContain(
				"Revoked ci (sk-sl_ci000001…). It has stopped working.",
			);
			expect(io.stderr()).not.toContain("secondlayer login");
		});
	}

	test("warns when the CLI login used the revoked key", async () => {
		const { deps } = fakeDeps({ token: "sk-sl_ci000001REST" });
		await runRevoke("ci", { yes: true }, deps);
		expect(io.stderr()).toContain(
			"Your CLI login used this key. Run: secondlayer login",
		);
	});

	test("warns when SECONDLAYER_API_KEY holds the revoked key", async () => {
		const { deps } = fakeDeps({ envKey: "sk-sl_ci000001REST" });
		await runRevoke("ci", { yes: true }, deps);
		expect(io.stderr()).toContain("SECONDLAYER_API_KEY holds the revoked key");
	});

	test("--json reports the revoke and whether the login used it", async () => {
		const { deps } = fakeDeps({ token: "sk-sl_ci000001REST" });
		await runRevoke("ci", { yes: true, json: true }, deps);
		expect(JSON.parse(io.stdout())).toEqual({
			revoked: true,
			id: CI.id,
			prefix: "sk-sl_ci000001",
			name: "ci",
			loginRevoked: true,
		});
	});

	test("without -y on a non-TTY exits 1 and never calls DELETE", async () => {
		const { deps, calls } = fakeDeps({});
		const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
		Object.defineProperty(process.stdin, "isTTY", {
			value: false,
			configurable: true,
		});
		const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`exit ${code}`);
		}) as typeof process.exit);
		try {
			await expect(runRevoke("ci", {}, deps)).rejects.toThrow("exit 1");
		} finally {
			exit.mockRestore();
			if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
			else delete (process.stdin as { isTTY?: boolean }).isTTY;
		}
		expect(calls.map((c) => c.method)).toEqual(["GET"]);
		expect(io.stderr()).toContain("Re-run with -y");
	});
});

describe("keyInUse", () => {
	const deps = (token: string | null, envKey?: string) => ({
		apiUrl: API_URL,
		readSession: async () => (token ? { ...SESSION_BASE, token } : null),
		envKey,
	});

	test("matches a saved key login by prefix", async () => {
		expect(await keyInUse("sk-sl_ci000001", deps("sk-sl_ci000001X"))).toEqual({
			login: true,
			env: false,
		});
	});

	test("ignores a browser login and other keys", async () => {
		expect(await keyInUse("sk-sl_ci000001", deps("ss-sl_browser"))).toEqual({
			login: false,
			env: false,
		});
		expect(
			await keyInUse("sk-sl_ci000001", deps(null, "sk-sl_lp000002X")),
		).toEqual({ login: false, env: false });
	});

	test("an unreadable login counts as not in use", async () => {
		const result = await keyInUse("sk-sl_ci000001", {
			apiUrl: API_URL,
			readSession: async () => {
				throw new Error("EACCES");
			},
			envKey: undefined,
		});
		expect(result).toEqual({ login: false, env: false });
	});
});
