import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	HOSTED_KEY_HINT,
	apiRequest,
	getArchiveOpsClient,
	keyHint,
	readApiKey,
	readArchiveApiKey,
} from "./client.ts";

describe("hosted key resolution", () => {
	const saved = {
		url: process.env.SECONDLAYER_API_URL,
		token: process.env.INSTANCE_TOKEN,
		account: process.env.SECONDLAYER_API_KEY,
	};
	afterEach(() => {
		for (const [k, v] of [
			["SECONDLAYER_API_URL", saved.url],
			["INSTANCE_TOKEN", saved.token],
			["SECONDLAYER_API_KEY", saved.account],
		] as const) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("reads SECONDLAYER_API_KEY when pointed at the hosted API", () => {
		process.env.SECONDLAYER_API_URL = "https://api.secondlayer.tools";
		process.env.SECONDLAYER_API_KEY = "sk-sl_account";
		process.env.INSTANCE_TOKEN = "token-from-init";
		expect(readApiKey()).toBe("sk-sl_account");
	});

	it("keyHint points at the account key on the hosted API", () => {
		expect(keyHint("https://api.secondlayer.tools")).toContain(
			"SECONDLAYER_API_KEY",
		);
	});

	it("keyHint points at INSTANCE_TOKEN on an instance", () => {
		expect(keyHint("http://127.0.0.1:3800")).toContain("INSTANCE_TOKEN");
	});
});

describe("MCP credential resolution", () => {
	const originalToken = process.env.INSTANCE_TOKEN;
	const originalLegacy = process.env.SL_API_KEY;
	const originalAccount = process.env.SECONDLAYER_API_KEY;

	beforeEach(() => {
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SL_API_KEY;
		delete process.env.SECONDLAYER_API_KEY;
	});

	afterEach(() => {
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
		if (originalLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = originalLegacy;
		if (originalAccount === undefined) delete process.env.SECONDLAYER_API_KEY;
		else process.env.SECONDLAYER_API_KEY = originalAccount;
	});

	it("reads INSTANCE_TOKEN on its own", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		expect(readApiKey()).toBe("token-from-init");
	});

	it("ignores SL_API_KEY (hosted account key, not instance)", () => {
		process.env.SL_API_KEY = "sk-sl_legacy";
		expect(readApiKey()).toBeUndefined();
	});

	it("prefers INSTANCE_TOKEN; SL_API_KEY does not override", () => {
		process.env.INSTANCE_TOKEN = "token-from-init";
		process.env.SL_API_KEY = "sk-sl_legacy";
		expect(readApiKey()).toBe("token-from-init");
	});

	it("treats an empty value as unset", () => {
		process.env.INSTANCE_TOKEN = "";
		expect(readApiKey()).toBeUndefined();
		process.env.SL_API_KEY = "";
		expect(readApiKey()).toBeUndefined();
	});
});

describe("hosted archive ops credentials", () => {
	const originalArchiveKey = process.env.SL_ARCHIVE_API_KEY;
	const originalToken = process.env.INSTANCE_TOKEN;
	const originalLegacy = process.env.SL_API_KEY;
	const originalAccount = process.env.SECONDLAYER_API_KEY;

	beforeEach(() => {
		delete process.env.SL_ARCHIVE_API_KEY;
		delete process.env.INSTANCE_TOKEN;
		delete process.env.SL_API_KEY;
		delete process.env.SECONDLAYER_API_KEY;
	});

	afterEach(() => {
		if (originalArchiveKey === undefined) delete process.env.SL_ARCHIVE_API_KEY;
		else process.env.SL_ARCHIVE_API_KEY = originalArchiveKey;
		if (originalToken === undefined) delete process.env.INSTANCE_TOKEN;
		else process.env.INSTANCE_TOKEN = originalToken;
		if (originalLegacy === undefined) delete process.env.SL_API_KEY;
		else process.env.SL_API_KEY = originalLegacy;
		if (originalAccount === undefined) delete process.env.SECONDLAYER_API_KEY;
		else process.env.SECONDLAYER_API_KEY = originalAccount;
	});

	it("does not treat INSTANCE_TOKEN as the hosted bearer", () => {
		process.env.INSTANCE_TOKEN = "instance-token";
		expect(readArchiveApiKey()).toBeUndefined();
		expect(() => getArchiveOpsClient()).toThrow(HOSTED_KEY_HINT);
	});

	it("reads SECONDLAYER_API_KEY", () => {
		process.env.INSTANCE_TOKEN = "instance-token";
		process.env.SECONDLAYER_API_KEY = "sk-sl_primary";
		expect(readArchiveApiKey()).toBe("sk-sl_primary");
	});

	it("ignores SL_API_KEY / SL_ARCHIVE_API_KEY (dropped aliases)", () => {
		process.env.INSTANCE_TOKEN = "instance-token";
		process.env.SL_API_KEY = "sk-sl_alias";
		process.env.SL_ARCHIVE_API_KEY = "sk-sl_credits";
		expect(readArchiveApiKey()).toBeUndefined();
		expect(() => getArchiveOpsClient()).toThrow(HOSTED_KEY_HINT);
	});

	it("getArchiveOpsClient constructs with accountKey", () => {
		process.env.SECONDLAYER_API_KEY = "sk-sl_primary";
		const client = getArchiveOpsClient();
		expect(client).toBeDefined();
	});
});

describe("apiRequest errors", () => {
	const originalFetch = globalThis.fetch;
	const savedUrl = process.env.SECONDLAYER_API_URL;
	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (savedUrl === undefined) {
			delete process.env.SECONDLAYER_API_URL;
		} else process.env.SECONDLAYER_API_URL = savedUrl;
	});

	async function caught(res: Response) {
		process.env.SECONDLAYER_API_URL = "https://api.secondlayer.tools";
		globalThis.fetch = (async () => res) as unknown as typeof fetch;
		try {
			await apiRequest("GET", "/x");
		} catch (err) {
			return err as Error & { status: number; code?: string; body?: unknown };
		}
		throw new Error("expected apiRequest to throw");
	}

	it("keeps the parsed body and code on a JSON error", async () => {
		const body = {
			error: "x",
			code: "INVALID_COLUMN",
			request_id: "req_abc12345",
			feedback: { url: "/v1/feedback" },
		};
		const err = await caught(
			new Response(JSON.stringify(body), { status: 400 }),
		);
		expect(err.status).toBe(400);
		expect(err.code).toBe("INVALID_COLUMN");
		expect((err.body as typeof body).request_id).toBe("req_abc12345");
		expect(err.message).toContain("INVALID_COLUMN");
	});

	it("attaches no body or code to a plain-text error", async () => {
		const err = await caught(new Response("Bad Gateway", { status: 502 }));
		expect(err.status).toBe(502);
		expect(err.body).toBeUndefined();
		expect(err.code).toBeUndefined();
		expect(err.message).toBe("Bad Gateway");
	});
});
