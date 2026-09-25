import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCHIVE_ROOT_PUBLIC_KEY_PEM } from "@secondlayer/shared/archive/root-key";
import {
	buildInstanceEnv,
	loadExistingInstanceEnv,
	parseInstanceNetwork,
	renderInstanceEnv,
	writeInstanceEnv,
} from "./instance-init.ts";

describe("instance init", () => {
	test("rejects unknown networks", () => {
		expect(() => parseInstanceNetwork("regtest")).toThrow(/mainnet/);
	});

	test("reuses an existing token, secrets key, and signing key", () => {
		const env = buildInstanceEnv({
			network: "devnet",
			existing: {
				INSTANCE_TOKEN: "tok",
				SECONDLAYER_SECRETS_KEY: "a".repeat(64),
				STREAMS_SIGNING_PRIVATE_KEY:
					"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
			},
		});
		expect(env.INSTANCE_TOKEN).toBe("tok");
		expect(env.SECONDLAYER_API_KEY).toBeUndefined();
		expect(env.SECONDLAYER_SECRETS_KEY).toBe("a".repeat(64));
		expect(env.STREAMS_SIGNING_PRIVATE_KEY).toContain("BEGIN PRIVATE KEY");
		expect(env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY).toBe(
			env.STREAMS_SIGNING_PRIVATE_KEY,
		);
		expect(env.ALLOW_UNSIGNED_WEBHOOKS).toBe("false");
		expect(env.STACKS_NETWORK).toBe("devnet");
	});

	test("fresh env renders INSTANCE_TOKEN and omits hex hosted-key lines", () => {
		const fresh = buildInstanceEnv({ network: "mainnet" });
		const body = renderInstanceEnv(fresh);
		expect(body).toContain("INSTANCE_TOKEN=");
		expect(body).toContain("SECONDLAYER_API_URL=");
		expect(body).not.toMatch(/SECONDLAYER_API_KEY=[0-9a-f]{64}/);
		expect(body).not.toContain("SL_API_URL=");
		expect(body).not.toContain("SL_API_KEY=");
		expect(body).not.toContain("SECONDLAYER_API_KEY=");
		expect(fresh.INSTANCE_TOKEN).toHaveLength(64);
	});

	test("a legacy SL_API_KEY line in an existing .env is ignored, not recovered as INSTANCE_TOKEN", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-init-legacy-"));
		writeFileSync(
			join(dir, ".env.local"),
			`SL_API_KEY=${"b".repeat(64)}\nSL_API_URL=https://api.secondlayer.tools\n`,
		);
		const existing = loadExistingInstanceEnv(dir);
		expect(Object.keys(existing)).not.toContain("SL_API_KEY");
		expect(Object.keys(existing)).not.toContain("SL_API_URL");
		const env = buildInstanceEnv({ network: "mainnet", existing });
		expect(env.INSTANCE_TOKEN).not.toBe("b".repeat(64));
		expect(env.INSTANCE_TOKEN).toHaveLength(64);
		expect(env.SECONDLAYER_API_URL).toBe("http://127.0.0.1:3800");
	});

	test("preserves an existing sk-sl_* hosted key as SECONDLAYER_API_KEY, with no SL_API_KEY alias line", () => {
		const env = buildInstanceEnv({
			network: "mainnet",
			existing: {
				INSTANCE_TOKEN: "tok",
				SECONDLAYER_API_KEY: "sk-sl_keep",
			},
		});
		expect(env.INSTANCE_TOKEN).toBe("tok");
		expect(env.SECONDLAYER_API_KEY).toBe("sk-sl_keep");
		const body = renderInstanceEnv(env);
		expect(body).toContain("SECONDLAYER_API_KEY=sk-sl_keep");
		expect(body).not.toContain("SL_API_KEY=");
	});

	test("always writes the archive trust key, keeping an operator's own pin across re-runs", () => {
		const fresh = buildInstanceEnv({ network: "mainnet" });
		expect(fresh.ARCHIVE_SIGNING_PUBLIC_KEY).toBe(ARCHIVE_ROOT_PUBLIC_KEY_PEM);
		expect(renderInstanceEnv(fresh)).toContain("ARCHIVE_SIGNING_PUBLIC_KEY=");

		const resolved = buildInstanceEnv({
			network: "mainnet",
			archivePublicKeyPem: "resolved-key",
		});
		expect(resolved.ARCHIVE_SIGNING_PUBLIC_KEY).toBe("resolved-key");

		const pinned = buildInstanceEnv({
			network: "mainnet",
			existing: { ARCHIVE_SIGNING_PUBLIC_KEY: "operator-pin" },
			archivePublicKeyPem: "resolved-key",
		});
		expect(pinned.ARCHIVE_SIGNING_PUBLIC_KEY).toBe("operator-pin");

		const dir = mkdtempSync(join(tmpdir(), "sl-init-key-"));
		writeInstanceEnv(dir, fresh);
		expect(loadExistingInstanceEnv(dir).ARCHIVE_SIGNING_PUBLIC_KEY).toBe(
			ARCHIVE_ROOT_PUBLIC_KEY_PEM,
		);
	});

	test("writes a 0600 env file and survives a restart", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-init-"));
		const env = buildInstanceEnv({ network: "mainnet" });
		const path = writeInstanceEnv(dir, env);
		const body = readFileSync(path, "utf8");
		expect(body).toContain("INSTANCE_MODE=oss");
		expect(body).toContain(`INSTANCE_TOKEN=${env.INSTANCE_TOKEN}`);
		expect(body).toContain("ALLOW_UNSIGNED_WEBHOOKS=false");
		expect(body).toContain("STREAMS_SIGNING_PRIVATE_KEY=");
		expect(body).toContain("SECONDLAYER_API_URL=");
		expect(body).not.toContain("SL_API_KEY=");
		expect(env.INSTANCE_TOKEN).toHaveLength(64);
		expect(env.SECONDLAYER_SECRETS_KEY).toHaveLength(64);

		const again = buildInstanceEnv({
			network: "mainnet",
			existing: loadExistingInstanceEnv(dir),
		});
		expect(again.INSTANCE_TOKEN).toBe(env.INSTANCE_TOKEN);
		expect(again.SECONDLAYER_SECRETS_KEY).toBe(env.SECONDLAYER_SECRETS_KEY);
		expect(again.STREAMS_SIGNING_PRIVATE_KEY).toBe(
			env.STREAMS_SIGNING_PRIVATE_KEY,
		);
	});
});
