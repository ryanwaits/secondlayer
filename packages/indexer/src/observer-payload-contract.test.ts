import { describe, expect, test } from "bun:test";
import {
	type ObserverJournalExportRow,
	type SbaObserverMessage,
	messageFromRow,
	writeObserverDump,
} from "./observer-export.ts";
import { parseObserverBody, sha256Hex } from "./observer-journal.ts";
import { parseBlock } from "./parser.ts";
import type { NewBlockPayload } from "./types/node-events.ts";

const HEX_LIKE = /^0x[0-9a-fA-F]+$/;

const FIXTURES = [
	{
		name: "timestamp",
		file: "new_block.timestamp.json",
		present: ["timestamp"] as const,
		absent: ["burn_block_time"] as const,
	},
	{
		name: "burn_block_time",
		file: "new_block.burn_block_time.json",
		present: ["burn_block_time"] as const,
		absent: ["timestamp"] as const,
	},
	{
		name: "both_time_keys",
		file: "new_block.both_time_keys.json",
		present: ["timestamp", "burn_block_time"] as const,
		absent: [] as const,
	},
] as const;

async function loadFixture(file: string): Promise<{
	fileBytes: Buffer;
	payload: NewBlockPayload;
}> {
	const url = new URL(`../test/fixtures/observer/${file}`, import.meta.url);
	const fileBytes = Buffer.from(await Bun.file(url).arrayBuffer());
	const payload = JSON.parse(fileBytes.toString("utf8")) as NewBlockPayload;
	return { fileBytes, payload };
}

function exportRow(
	fileBytes: Buffer,
	blockHeight: number,
): ObserverJournalExportRow {
	return {
		sequence: "1",
		path: "/new_block",
		raw_body: fileBytes,
		raw_body_sha256: sha256Hex(fileBytes),
		block_height: blockHeight,
		block_hash: null,
		received_at: new Date("2026-01-01T00:00:00.000Z"),
		status: "processed",
	};
}

describe("observer payload contract", () => {
	for (const fixture of FIXTURES) {
		test(`${fixture.name}: file bytes, time keys, export dump, parseBlock`, async () => {
			const { fileBytes, payload } = await loadFixture(fixture.file);
			const fileSha = sha256Hex(fileBytes);

			expect(payload.index_block_hash).toMatch(HEX_LIKE);
			expect(payload.index_block_hash.length).toBeGreaterThan(2);

			const parsed = parseObserverBody<NewBlockPayload>(fileBytes);
			for (const key of fixture.present) {
				expect(key in parsed).toBe(true);
			}
			for (const key of fixture.absent) {
				expect(key in parsed).toBe(false);
			}

			const message = messageFromRow(
				exportRow(fileBytes, payload.block_height),
			);
			expect(message.content_sha256).toBe(fileSha);

			const chunks: string[] = [];
			writeObserverDump([message], {
				write: (chunk) => chunks.push(chunk),
			});
			const line = chunks.join("").trimEnd();
			const dumped = JSON.parse(line) as SbaObserverMessage;
			const dumpedPayload = dumped.payload as Record<string, unknown>;

			expect(dumped.content_sha256).toBe(fileSha);
			expect(dumpedPayload.index_block_hash).toBe(payload.index_block_hash);
			for (const key of fixture.present) {
				expect(key in dumpedPayload).toBe(true);
				expect(dumpedPayload[key]).toBe(payload[key]);
			}
			for (const key of fixture.absent) {
				expect(key in dumpedPayload).toBe(false);
			}

			expect(() => parseBlock(payload)).not.toThrow();
			const block = parseBlock(payload);
			expect(block.index_block_hash).toBe(payload.index_block_hash);
			expect(block.height).toBe(payload.block_height);
		});
	}
});
