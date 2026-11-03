import { describe, expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
// The API's own rule, not a copy of it: a devnet that publishes past loopback
// would key every /v1 read, and the docs promise the opposite.
import {
	decideInstanceAuth,
	isLoopbackReachable,
} from "../../api/src/instance-bind.ts";
import { shortVal } from "../src/commands/devnet.ts";
import {
	DEV_INSTANCE_TOKEN,
	buildDevnetCompose,
} from "../src/lib/devnet-compose.ts";

/** The `ports:` spec for a service, minus the `:<containerPort>` suffix. */
function publishedSpec(compose: string, containerPort: number): string {
	const match = compose.match(
		new RegExp(`^\\s+- "(.+):${containerPort}"$`, "m"),
	);
	if (!match?.[1]) throw new Error(`no ports entry for :${containerPort}`);
	return match[1];
}

function envValue(compose: string, key: string): string {
	const match = compose.match(new RegExp(`^\\s+${key}: "?([^"\\n]+)"?$`, "m"));
	if (!match?.[1]) throw new Error(`no ${key} in compose`);
	return match[1];
}

describe("generated devnet compose", () => {
	const compose = buildDevnetCompose();

	test("publishes the api on loopback only", () => {
		expect(publishedSpec(compose, 3800)).toBe("127.0.0.1:3800");
	});

	test("honors a custom api port on loopback", () => {
		const custom = buildDevnetCompose({ apiPort: 4800 });
		expect(publishedSpec(custom, 3800)).toBe("127.0.0.1:4800");
		expect(envValue(custom, "API_PUBLISH_ADDR")).toBe("127.0.0.1:4800");
	});

	test("API_PUBLISH_ADDR matches the spec the api is published with", () => {
		// One value, two places: drift here silently keys every read.
		expect(envValue(compose, "API_PUBLISH_ADDR")).toBe(
			publishedSpec(compose, 3800),
		);
	});

	test("devnet /v1 reads need no credential", () => {
		expect(
			isLoopbackReachable({
				API_PUBLISH_ADDR: envValue(compose, "API_PUBLISH_ADDR"),
				LISTEN_HOST: envValue(compose, "LISTEN_HOST"),
			}),
		).toBe(true);
	});

	test("keeps the instance token so the container can boot", () => {
		// The boot guard reads the listen host, which must be 0.0.0.0 in a
		// container — tokenless, the api refuses to start at all.
		expect(envValue(compose, "LISTEN_HOST")).toBe("0.0.0.0");
		expect(envValue(compose, "INSTANCE_TOKEN")).toBe(DEV_INSTANCE_TOKEN);
		expect(
			decideInstanceAuth({ host: "0.0.0.0", token: DEV_INSTANCE_TOKEN }),
		).toEqual({ start: true, requireToken: true });
		expect(decideInstanceAuth({ host: "0.0.0.0", token: null })).toEqual({
			start: false,
			reason: "unauthenticated-bind",
		});
	});

	test("publishes the indexer on every interface for the devnet node", () => {
		// stacks-node runs in its own container and POSTs to
		// host.docker.internal:3700 — the host gateway, not 127.0.0.1.
		expect(publishedSpec(compose, 3700)).toBe("3700");
	});

	test("keeps postgres off the host entirely", () => {
		expect(compose).not.toMatch(/:5432"/);
	});

	test("uses the multi-arch one-box runtime image", () => {
		expect(compose).toContain("ghcr.io/ryanwaits/secondlayer-runtime:latest");
		expect(compose).not.toContain("secondlayer-api:");
		expect(compose).not.toContain("secondlayer-indexer:");
	});

	test("runs the decoder and webhook plane (streams-index source)", () => {
		expect(envValue(compose, "SUBGRAPH_SOURCE")).toBe("streams-index");
	});

	test("signs devnet webhooks with a valid ed25519 key", () => {
		const pem = envValue(compose, "SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY");
		const key = createPrivateKey(pem.replace(/\\n/g, "\n"));
		expect(key.asymmetricKeyType).toBe("ed25519");
	});

	test("boots under the runtime's disk floor", () => {
		expect(envValue(compose, "SECONDLAYER_ALLOW_UNDERSIZED")).toBe("true");
	});

	test("ingests observer blocks live instead of waiting for an archive", () => {
		expect(envValue(compose, "INGEST_MODE")).toBe("live");
	});

	test("never reaches out to mainnet", () => {
		expect(envValue(compose, "AUTO_BACKFILL_ENABLED")).toBe("false");
		expect(envValue(compose, "TIP_FOLLOWER_ENABLED")).toBe("false");
	});
});

describe("status activity values", () => {
	test("renders jsonb objects as JSON, not [object Object]", () => {
		const out = shortVal({ event: "incremented", value: "1" });
		expect(out).not.toContain("[object Object]");
		expect(out.startsWith('{"even')).toBe(true);
	});
});
