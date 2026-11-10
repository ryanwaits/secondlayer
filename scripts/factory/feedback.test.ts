import { expect, test } from "bun:test";
import { secondlayerFeedback, toIncoming } from "./feedback.ts";

const row = (over: Record<string, unknown> = {}) => ({
	id: "11111111-1111-1111-1111-111111111111",
	intent: "next_cursor is wrong\nsecond line",
	expected: "null",
	kind_hint: "bug",
	evidence: { tx_id: "0xabc" },
	attempted: { method: "GET", path: "/v1/index/ft-transfers", status: 200 },
	origin: "sdk",
	status: "classified",
	route: "docs",
	classification: { kind: "docs_mismatch", reason: "doc says otherwise" },
	created_at: "2026-11-01T00:00:00.000Z",
	...over,
});

function fakeExec(outs: string[], exitCode = 0, stderr = "") {
	const calls: { argv: string[]; cwd: string }[] = [];
	let i = 0;
	const exec = async (argv: string[], o: { cwd: string }) => {
		calls.push({ argv, cwd: o.cwd });
		return { exitCode, stdout: outs[i++] ?? "[]", stderr, ms: 1 };
	};
	return { exec, calls };
}

const adapter = (extra: Record<string, unknown> = {}) =>
	secondlayerFeedback({ repo: "/repo", project: "SL", ...extra });

test("two calls, --internal only on the second, cwd = repo", async () => {
	const { exec, calls } = fakeExec(["[]", "[]"]);
	await adapter().pull({ exec });
	expect(calls).toHaveLength(2);
	expect(calls[0]?.argv).not.toContain("--internal");
	expect(calls[1]?.argv).toContain("--internal");
	expect(calls.every((c) => c.cwd === "/repo")).toBe(true);
	expect(calls[0]?.argv).toContain("--json");
	expect(calls[0]?.argv).toContain("classified");
});

test("drops low_priority and skipped ids; internal gets requester dogfood", async () => {
	const keep = row({ id: "keep" });
	const low = row({ id: "low", route: "low_priority" });
	const skipped = row({ id: "skip" });
	const internal = row({ id: "int", route: "human" });
	const { exec } = fakeExec([
		JSON.stringify([keep, low, skipped]),
		JSON.stringify([internal]),
	]);
	const items = await adapter({ skipTicketIds: ["skip"] }).pull({ exec });
	expect(items.map((i) => i.id)).toEqual(["keep", "int"]);
	expect(items[0]?.requester.name).toBe("feedback");
	expect(items[1]?.requester.name).toBe("dogfood");
});

test("non-zero exit throws with stderr tail", async () => {
	const { exec } = fakeExec([], 1, "boom\nbad thing");
	await expect(adapter().pull({ exec })).rejects.toThrow(
		/feedback-queue failed \(1\): .*bad thing/s,
	);
});

test("exit 2 with no db says to set TARGET_DATABASE_URL", async () => {
	const { exec } = fakeExec(
		[],
		2,
		"no db: set TARGET_DATABASE_URL or DATABASE_URL",
	);
	await expect(adapter().pull({ exec })).rejects.toThrow(
		"set TARGET_DATABASE_URL",
	);
});

test("invalid JSON throws", async () => {
	const { exec } = fakeExec(["not json"]);
	await expect(adapter().pull({ exec })).rejects.toThrow();
});

test("body has route and ticket id; title is first line", () => {
	const i = toIncoming(row() as never, "SL", false);
	expect(i.title).toBe("next_cursor is wrong");
	expect(i.body).toContain("Route: docs (doc says otherwise)");
	expect(i.body).toContain("Ticket: 11111111-1111-1111-1111-111111111111");
	expect(i.body).toContain("Attempted: GET /v1/index/ft-transfers -> 200");
});
