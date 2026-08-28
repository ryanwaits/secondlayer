import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
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
		expect(env.SL_API_KEY).toBe("tok");
		expect(env.SECONDLAYER_SECRETS_KEY).toBe("a".repeat(64));
		expect(env.STREAMS_SIGNING_PRIVATE_KEY).toContain("BEGIN PRIVATE KEY");
		expect(env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY).toBe(
			env.STREAMS_SIGNING_PRIVATE_KEY,
		);
		expect(env.ALLOW_UNSIGNED_WEBHOOKS).toBe("false");
		expect(env.STACKS_NETWORK).toBe("devnet");
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
