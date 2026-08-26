import { describe, expect, test } from "bun:test";
import {
	type ObserverJournalExportRow,
	type SbaObserverMessage,
	filterObserverExportRows,
	messageFromRow,
	writeObserverDump,
} from "./observer-export.ts";
import { bodyFromText, sha256Hex } from "./observer-journal.ts";

function row(partial: {
	sequence: string;
	path?: string;
	bodyText: string;
	block_height: number | null;
	status?: string;
	block_hash?: string | null;
	received_at?: Date | string;
}): ObserverJournalExportRow {
	const raw_body = bodyFromText(partial.bodyText);
	return {
		sequence: partial.sequence,
		path: partial.path ?? "/new_block",
		raw_body,
		raw_body_sha256: sha256Hex(raw_body),
		block_height: partial.block_height,
		block_hash: partial.block_hash ?? null,
		received_at: partial.received_at ?? new Date("2026-01-01T00:00:00.000Z"),
		status: partial.status ?? "processed",
	};
}

describe("observer export", () => {
	test("content_sha256 is of raw bytes, not re-serialized JSON", () => {
		// Spaces make raw bytes differ from JSON.stringify(payload).
		const bodyText =
			'{ "b": 1, "a": 2, "index_block_hash": "0xidx", "block_height": 10 }';
		const journalRow = row({
			sequence: "1",
			bodyText,
			block_height: 10,
		});
		const message = messageFromRow(journalRow);
		const payload = message.payload as Record<string, unknown>;

		expect(message.content_sha256).toBe(journalRow.raw_body_sha256);
		expect(message.content_sha256).toBe(sha256Hex(journalRow.raw_body));
		expect(Object.keys(payload)).toEqual([
			"b",
			"a",
			"index_block_hash",
			"block_height",
		]);
		expect(message.content_sha256).not.toBe(sha256Hex(JSON.stringify(payload)));
		expect(message.index_block_hash).toBe("0xidx");
		expect(message.block_height).toBe(10);
	});

	test("dual timestamp keys preserved in dump lines", () => {
		const withTimestamp = row({
			sequence: "1",
			bodyText:
				'{"block_height":1,"index_block_hash":"0xa","timestamp":1700000000}',
			block_height: 1,
		});
		const withBurnBlockTime = row({
			sequence: "2",
			bodyText:
				'{"block_height":2,"index_block_hash":"0xb","burn_block_time":1700000001}',
			block_height: 2,
		});

		const chunks: string[] = [];
		writeObserverDump(
			[messageFromRow(withTimestamp), messageFromRow(withBurnBlockTime)],
			{ write: (chunk) => chunks.push(chunk) },
		);

		const lines = chunks.join("").trimEnd().split("\n");
		expect(lines).toHaveLength(2);

		const first = JSON.parse(lines[0] as string) as SbaObserverMessage;
		const second = JSON.parse(lines[1] as string) as SbaObserverMessage;
		const firstPayload = first.payload as Record<string, unknown>;
		const secondPayload = second.payload as Record<string, unknown>;

		expect(firstPayload.timestamp).toBe(1700000000);
		expect("burn_block_time" in firstPayload).toBe(false);
		expect(secondPayload.burn_block_time).toBe(1700000001);
		expect("timestamp" in secondPayload).toBe(false);
		expect(first.content_sha256).toBe(withTimestamp.raw_body_sha256);
		expect(second.content_sha256).toBe(withBurnBlockTime.raw_body_sha256);
	});

	test("afterHeight is exclusive", () => {
		const rows = [
			row({
				sequence: "1",
				bodyText: '{"block_height":5,"index_block_hash":"0x5"}',
				block_height: 5,
			}),
			row({
				sequence: "2",
				bodyText: '{"block_height":6,"index_block_hash":"0x6"}',
				block_height: 6,
			}),
			row({
				sequence: "3",
				bodyText: '{"block_height":7,"index_block_hash":"0x7"}',
				block_height: 7,
			}),
		];

		const filtered = filterObserverExportRows(rows, {
			afterHeight: 5,
			limit: 10,
		});
		expect(filtered.map((r) => r.block_height)).toEqual([6, 7]);

		const afterHash = filterObserverExportRows(rows, {
			afterHeight: 5,
			afterIndexBlockHash: "0x5",
			limit: 10,
		});
		expect(afterHash.map((r) => r.block_height)).toEqual([6, 7]);
	});

	test("same-height rows order by numeric sequence", () => {
		// Insert out of string order so "10" < "9" would fail if compared as text.
		const rows = [
			row({
				sequence: "10",
				bodyText: '{"block_height":42,"index_block_hash":"0x10"}',
				block_height: 42,
			}),
			row({
				sequence: "9",
				bodyText: '{"block_height":42,"index_block_hash":"0x9"}',
				block_height: 42,
			}),
		];

		const listed = filterObserverExportRows(rows, { limit: 10 });
		expect(listed.map((r) => r.sequence)).toEqual(["9", "10"]);

		const afterNine = filterObserverExportRows(rows, {
			afterHeight: 42,
			afterIndexBlockHash: "0x9",
			limit: 10,
		});
		expect(afterNine.map((r) => r.sequence)).toEqual(["10"]);
	});

	test("skips status != processed", () => {
		const rows = [
			row({
				sequence: "1",
				bodyText: '{"block_height":1,"index_block_hash":"0x1"}',
				block_height: 1,
				status: "received",
			}),
			row({
				sequence: "2",
				bodyText: '{"block_height":2,"index_block_hash":"0x2"}',
				block_height: 2,
				status: "failed",
			}),
			row({
				sequence: "3",
				bodyText: '{"block_height":3,"index_block_hash":"0x3"}',
				block_height: 3,
				status: "processed",
			}),
		];

		const filtered = filterObserverExportRows(rows, { limit: 10 });
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.sequence).toBe("3");
		expect(filtered[0]?.status).toBe("processed");
	});
});
