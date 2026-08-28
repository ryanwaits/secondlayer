import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "../../..");

function read(rel: string): string {
	return readFileSync(join(repo, rel), "utf8");
}

/** OSS compose and env must not require hosted commerce, Redis, or R2. */
describe("OSS offline posture", () => {
	const compose = read("docker/oss/docker-compose.yml");
	const envExample = read("docker/oss/.env.example");
	const createApp = read("packages/api/src/create-app.ts");
	const bootstrap = read("packages/cli/src/commands/bootstrap.ts");
	const verify = read("packages/cli/src/commands/verify.ts");
	const repair = read("packages/cli/src/commands/repair.ts");

	test("compose does not require Stripe, Redis, Slack, email, or R2", () => {
		expect(compose).not.toMatch(/STRIPE_/);
		expect(compose).not.toMatch(/REDIS_URL/);
		expect(compose).not.toMatch(/RESEND_/);
		expect(compose).not.toMatch(/SLACK_/);
		expect(compose).not.toMatch(/STREAMS_BULK_R2_/);
		expect(compose).not.toMatch(/api\.secondlayer\.tools/);
		expect(compose).toContain("INSTANCE_MODE: oss");
		expect(compose).toContain("INSTANCE_TOKEN");
		expect(compose).toContain(
			"ALLOW_UNSIGNED_WEBHOOKS: ${ALLOW_UNSIGNED_WEBHOOKS:-false}",
		);
	});

	test("env example does not default unsigned webhooks or hosted API", () => {
		expect(envExample).toContain("ALLOW_UNSIGNED_WEBHOOKS=false");
		expect(envExample).not.toMatch(/STRIPE_/);
		expect(envExample).not.toMatch(/REDIS_URL/);
		expect(envExample).not.toMatch(/api\.secondlayer\.tools/);
	});

	test("OSS app does not mount Stripe or hosted billing", () => {
		expect(createApp).toContain('if (mode === "platform")');
		expect(createApp).toContain("webhooksStripeRouter");
		expect(createApp).toContain("billingRouter");
	});

	test("bootstrap, verify, and repair share one key resolver and never fetch the hosted API in OSS", () => {
		for (const source of [bootstrap, verify, repair]) {
			expect(source).toContain("resolveArchivePublicKey");
			expect(source).toContain("allowHostedApi: !isOssMode()");
			expect(source).not.toMatch(/resolvePublicKey\(/);
			expect(source).not.toMatch(/SL_API_URL/);
		}
	});
});
