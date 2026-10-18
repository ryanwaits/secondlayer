import { describe, expect, test } from "bun:test";
import type { WebhookReplay } from "../types.ts";
import { progressOf } from "./webhook-replays.ts";

function record(over: Partial<WebhookReplay> = {}): WebhookReplay {
	return {
		id: "0123456789abcdef",
		webhook_id: "00000000-0000-0000-0000-000000000001",
		from_block: 100,
		to_block: 200,
		status: "running",
		scanned_count: 5,
		enqueued_count: 9,
		total: null,
		delivered: null,
		gave_up: null,
		error: null,
		started_at: new Date("2026-10-18T10:00:00Z"),
		finished_at: null,
		...over,
	};
}

describe("progressOf", () => {
	test("a running replay counts processed as enqueued minus pending", () => {
		const p = progressOf(record(), 5);
		expect(p).toMatchObject({
			status: "running",
			total: 9,
			processed: 4,
			pending: 5,
			delivered: null,
			gaveUp: null,
			finishedAt: null,
		});
	});

	test("a done replay reports its stored counts whatever the live count says", () => {
		const p = progressOf(
			record({
				status: "done",
				total: 9,
				delivered: 7,
				gave_up: 2,
				finished_at: new Date("2026-10-18T10:05:00Z"),
			}),
			0,
		);
		expect(p).toMatchObject({
			status: "done",
			total: 9,
			processed: 9,
			pending: 0,
			delivered: 7,
			gaveUp: 2,
			finishedAt: "2026-10-18T10:05:00.000Z",
		});
	});

	test("a failed replay passes its error through", () => {
		const p = progressOf(record({ status: "failed", error: "boom" }), 0);
		expect(p.status).toBe("failed");
		expect(p.error).toBe("boom");
	});

	test("bigint block heights become numbers", () => {
		const p = progressOf(record({ from_block: 100n, to_block: 200n }), 0);
		expect(p.fromBlock).toBe(100);
		expect(p.toBlock).toBe(200);
	});

	test("processed never goes negative when more rows are pending than enqueued", () => {
		expect(progressOf(record({ enqueued_count: 2 }), 5).processed).toBe(0);
	});
});
