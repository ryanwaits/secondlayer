import { describe, expect, it } from "bun:test";
import type { Subscription, SubscriptionOutbox } from "@secondlayer/shared/db";
import { buildForFormat } from "./index.ts";

const FIXED_CREATED_AT = new Date("2026-04-23T17:00:00.000Z");

function sub(overrides: Partial<Subscription>): Subscription {
	return {
		id: "sub-00000000-0000-0000-0000-000000000001",
		account_id: "acc-00000000-0000-0000-0000-000000000001",
		project_id: null,
		name: "test",
		status: "active",
		subgraph_name: "bitcoin",
		table_name: "transfers",
		filter: {},
		format: "standard-webhooks",
		runtime: null,
		url: "https://x",
		signing_secret_enc: Buffer.from(""),
		auth_config: {},
		max_retries: 7,
		timeout_ms: 10000,
		concurrency: 4,
		circuit_failures: 0,
		circuit_opened_at: null,
		last_delivery_at: null,
		last_success_at: null,
		last_error: null,
		created_at: FIXED_CREATED_AT,
		updated_at: FIXED_CREATED_AT,
		...overrides,
	};
}

function outbox(): SubscriptionOutbox {
	return {
		id: "out-00000000-0000-0000-0000-000000000001",
		subscription_id: "sub-00000000-0000-0000-0000-000000000001",
		subgraph_name: "bitcoin",
		table_name: "transfers",
		block_height: 1000,
		tx_id: "0xabc",
		row_pk: { blockHeight: 1000, txId: "0xabc", rowIndex: 0 },
		event_type: "bitcoin.transfers.created",
		payload: { sender: "SP1", recipient: "SP2", amount: "100" },
		dedup_key: "k",
		attempt: 0,
		next_attempt_at: FIXED_CREATED_AT,
		status: "pending",
		is_replay: false,
		delivered_at: null,
		failed_at: null,
		locked_by: null,
		locked_until: null,
		created_at: FIXED_CREATED_AT,
	};
}

describe("format dispatcher", () => {
	it("standard-webhooks emits 3 signed headers + SW body shape", () => {
		const s = sub({ format: "standard-webhooks" });
		const out = outbox();
		const nowSeconds = Math.floor(Date.now() / 1000);
		const { body, headers } = buildForFormat(out, s, "whsec_dGVzdA==");
		const parsed = JSON.parse(body);
		expect(parsed.type).toBe("bitcoin.transfers.created");
		expect(parsed.data).toEqual({
			sender: "SP1",
			recipient: "SP2",
			amount: "100",
		});
		expect(headers["webhook-id"]).toBe(out.id);
		// Timestamp stamped at dispatch time, not outbox creation — retries
		// must fall within the receiver's tolerance window (default 300s).
		// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
		const ts = Number.parseInt(headers["webhook-timestamp"]!, 10);
		expect(Math.abs(ts - nowSeconds)).toBeLessThan(5);
		expect(headers["webhook-signature"]).toMatch(/^v1,/);
		expect(headers["content-type"]).toBe("application/json");
	});

	it("inngest emits array body with name/data/id/ts/v", () => {
		const s = sub({ format: "inngest" });
		const { body, headers } = buildForFormat(outbox(), s, "");
		const parsed = JSON.parse(body);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed[0].name).toBe("bitcoin.transfers.created");
		expect(parsed[0].data).toEqual({
			sender: "SP1",
			recipient: "SP2",
			amount: "100",
		});
		expect(parsed[0].id).toBe("out-00000000-0000-0000-0000-000000000001");
		expect(parsed[0].ts).toBe(FIXED_CREATED_AT.getTime());
		expect(parsed[0].v).toBeDefined();
		expect(headers["content-type"]).toBe("application/json");
		expect(headers.authorization).toBeUndefined();
	});

	it("trigger emits {payload,options.idempotencyKey} + Bearer", () => {
		const s = sub({
			format: "trigger",
			auth_config: { authType: "bearer", token: "tr_live_abc" },
		});
		const { body, headers } = buildForFormat(outbox(), s, "");
		const parsed = JSON.parse(body);
		expect(parsed.payload.sender).toBe("SP1");
		expect(parsed.options.idempotencyKey).toBe(outbox().id);
		expect(headers.authorization).toBe("Bearer tr_live_abc");
	});

	it("cloudflare emits {params} + Bearer + outbox id", () => {
		const s = sub({
			format: "cloudflare",
			auth_config: { token: "cf_token_xyz" },
		});
		const { body, headers } = buildForFormat(outbox(), s, "");
		const parsed = JSON.parse(body);
		expect(parsed.params.sender).toBe("SP1");
		expect(parsed.params._type).toBe("bitcoin.transfers.created");
		expect(parsed.params._outboxId).toBe(outbox().id);
		expect(headers.authorization).toBe("Bearer cf_token_xyz");
	});

	it("cloudevents structured mode body + content-type", () => {
		const s = sub({ format: "cloudevents" });
		const { body, headers } = buildForFormat(outbox(), s, "");
		const parsed = JSON.parse(body);
		expect(parsed.specversion).toBe("1.0");
		expect(parsed.type).toBe("bitcoin.transfers.created");
		expect(parsed.source).toBe("secondlayer:bitcoin");
		expect(parsed.id).toBe(outbox().id);
		expect(parsed.time).toBe(FIXED_CREATED_AT.toISOString());
		expect(parsed.data).toEqual({
			sender: "SP1",
			recipient: "SP2",
			amount: "100",
		});
		expect(headers["content-type"]).toBe(
			"application/cloudevents+json; charset=utf-8",
		);
	});

	it("raw emits bare row + user content-type + custom headers", () => {
		const s = sub({
			format: "raw",
			auth_config: {
				contentType: "text/plain",
				headers: { "x-custom": "1" },
				authType: "basic",
				basicAuth: "dXNlcjpwYXNz",
			},
		});
		const { body, headers } = buildForFormat(outbox(), s, "");
		const parsed = JSON.parse(body);
		expect(parsed.sender).toBe("SP1");
		expect(parsed).not.toHaveProperty("type"); // no envelope
		expect(headers["content-type"]).toBe("text/plain");
		expect(headers["x-custom"]).toBe("1");
		expect(headers.authorization).toBe("Basic dXNlcjpwYXNz");
	});

	it("unknown format falls back to standard-webhooks", () => {
		const s = sub({
			format: "made-up" as unknown as Subscription["format"],
		});
		const { headers } = buildForFormat(outbox(), s, "whsec_dGVzdA==");
		expect(headers["webhook-signature"]).toMatch(/^v1,/);
	});
});
