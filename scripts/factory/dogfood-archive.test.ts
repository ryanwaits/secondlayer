import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archivedTicketIds, dogfoodArchive } from "./dogfood-archive.ts";

const dir = join(
	import.meta.dir,
	"../../plans/assets/344-dogfood/export-20261110",
);
const ctx = {};
// The archive lives outside git (plans/ is ignored): skip when absent.
const hasArchive = existsSync(dir);

test.skipIf(!hasArchive)(
	"pulls all 23 archived findings with unique ids",
	async () => {
		const items = await dogfoodArchive({ dir, project: "SL" }).pull(ctx);
		expect(items).toHaveLength(23);
		expect(new Set(items.map((i) => i.id)).size).toBe(23);
		expect(items.every((i) => i.kind === "new" && i.project === "SL")).toBe(
			true,
		);
	},
);

test.skipIf(!hasArchive)(
	"next-cursor carries state and ticket prefix",
	async () => {
		const items = await dogfoodArchive({ dir, project: "SL" }).pull(ctx);
		const body = items.find((i) => i.id === "next-cursor")?.body ?? "";
		expect(body).toContain("Dogfood state: fixing");
		expect(body).toContain("924ec39e");
	},
);

test.skipIf(!hasArchive)("archivedTicketIds is non-empty and unique", () => {
	const ids = archivedTicketIds(dir);
	expect(ids.length).toBeGreaterThan(0);
	expect(new Set(ids).size).toBe(ids.length);
});

test("a finding with only required fields still maps", async () => {
	const tmp = mkdtempSync(join(tmpdir(), "dogfood-"));
	mkdirSync(join(tmp, "findings"));
	writeFileSync(
		join(tmp, "findings", "min.json"),
		JSON.stringify({ id: "min", title: "Minimal" }),
	);
	const [item] = await dogfoodArchive({ dir: tmp, project: "SL" }).pull(ctx);
	expect(item?.title).toBe("Minimal");
	expect(item?.body).toContain("Dogfood state: unknown");
});
