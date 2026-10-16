import { describe, expect, test } from "bun:test";
import type { DetectedInsight } from "@secondlayer/shared/insights";
import {
	ACCOUNT_RULES,
	type AccountRuleInput,
	type RequestLogRow,
} from "./rules.ts";

const NOW = new Date("2026-10-15T18:00:00.000Z");
const MIN = 60_000;

const collected: DetectedInsight[] = [];

function input(over: Partial<AccountRuleInput> = {}): AccountRuleInput {
	return {
		now: NOW,
		requests: [],
		failed5xx: [],
		allowance: { firstPaidAt: null, paidRows: 0, paidUsdMicros: 0n },
		monthRows: 0,
		rowsByDay: [],
		cap: {
			monthlyCapCents: null,
			spentMonthUsdMicros: 0n,
			last7dChargesUsdMicros: 0n,
		},
		balanceUsdMicros: 50_000_000n,
		burnPerDayUsdMicros: 0n,
		...over,
	};
}

function rule(id: string) {
	const found = ACCOUNT_RULES.find((r) => r.id === id);
	if (!found) throw new Error(`no rule ${id}`);
	return found;
}

function fire(id: string, i: AccountRuleInput) {
	const out = rule(id).evaluate(i);
	if (out) collected.push(out);
	return out;
}

function request(over: Partial<RequestLogRow> & { at: Date }): RequestLogRow {
	const { at, ...rest } = over;
	return {
		apiKeyId: "key-1",
		pathTemplate: "/v1/index/ft-transfers",
		paramsHash: "p1",
		cursorHash: null,
		pageSize: 1000,
		rows: 1000,
		status: 200,
		createdAt: at,
		...rest,
	};
}

/** A paged read: first page then cursor pages, 1 second apart. */
function pagedRead(
	start: Date,
	rows: number[],
	over: Partial<RequestLogRow> = {},
): RequestLogRow[] {
	return rows.map((n, i) =>
		request({
			...over,
			at: new Date(start.getTime() + i * 1000),
			cursorHash: i === 0 ? null : `cursor-${i}`,
			rows: n,
		}),
	);
}

const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * MIN);

describe("duplicate_reads", () => {
	const pages = [1000, 1000, 587];

	test("fires when the same 3-page read repeats within an hour", () => {
		const out = fire(
			"duplicate_reads",
			input({
				requests: [...pagedRead(at(80), pages), ...pagedRead(at(62), pages)],
			}),
		);
		expect(out?.severity).toBe("costs");
		expect(out?.impact).toBe(2587);
		expect(out?.line).toBe("The same 2,587 rows were read twice");
		expect(out?.meta).toBe("16:40 and 16:58 UTC");
		expect(out?.resource).toEqual({
			kind: "account",
			id: "account",
			name: "Account",
		});
		expect(out?.handoff.commands).toEqual([]);
	});

	test("fires at exactly one hour apart, not a minute more", () => {
		const read = (gap: number) =>
			input({
				requests: [
					...pagedRead(at(gap + 30), pages),
					...pagedRead(at(30), pages),
				],
			});
		expect(fire("duplicate_reads", read(60))).not.toBeNull();
		expect(fire("duplicate_reads", read(61))).toBeNull();
	});

	test("needs 3 pages: two pages repeated is not enough", () => {
		expect(
			fire(
				"duplicate_reads",
				input({
					requests: [
						...pagedRead(at(40), [1000, 500]),
						...pagedRead(at(20), [1000, 500]),
					],
				}),
			),
		).toBeNull();
	});

	test("a different page sequence is not a duplicate", () => {
		expect(
			fire(
				"duplicate_reads",
				input({
					requests: [
						...pagedRead(at(40), pages),
						...pagedRead(at(20), [1000, 1000, 600]),
					],
				}),
			),
		).toBeNull();
	});

	test("different keys or queries never match, but two null keys do", () => {
		const other = (over: Partial<RequestLogRow>) =>
			input({
				requests: [
					...pagedRead(at(40), pages),
					...pagedRead(at(20), pages, over),
				],
			});
		expect(fire("duplicate_reads", other({ apiKeyId: "key-2" }))).toBeNull();
		expect(fire("duplicate_reads", other({ paramsHash: "p2" }))).toBeNull();
		expect(
			fire("duplicate_reads", other({ pathTemplate: "/v1/index/blocks" })),
		).toBeNull();

		const nulls = (over: Partial<RequestLogRow>) => ({
			apiKeyId: null,
			paramsHash: null,
			...over,
		});
		const requests = [
			...pagedRead(at(40), pages, nulls({})),
			...pagedRead(at(20), pages, nulls({})),
		].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
		expect(fire("duplicate_reads", input({ requests }))).not.toBeNull();
	});

	test("ignores reads older than a day", () => {
		expect(
			fire(
				"duplicate_reads",
				input({
					requests: [
						...pagedRead(at(26 * 60 + 30), pages),
						...pagedRead(at(26 * 60), pages),
					],
				}),
			),
		).toBeNull();
	});

	test("treats a null row count as zero rows", () => {
		const nullRows = (start: Date) =>
			pagedRead(start, [
				null as unknown as number,
				null as unknown as number,
				null as unknown as number,
			]);
		expect(
			fire(
				"duplicate_reads",
				input({ requests: [...nullRows(at(40)), ...nullRows(at(20))] }),
			),
		).not.toBeNull();
	});
});

describe("polling_loop", () => {
	/** `count` requests, `everyMin` apart, ending now; `emptyEvery` decides which are empty. */
	function poll(
		count: number,
		everyMin: number,
		isEmpty: (i: number) => boolean,
		jitter = (_i: number) => 0,
	) {
		return Array.from({ length: count }, (_, i) =>
			request({
				at: new Date(
					NOW.getTime() - (count - 1 - i) * everyMin * MIN + jitter(i),
				),
				rows: isEmpty(i) ? 0 : 5,
				cursorHash: null,
			}),
		);
	}

	test("fires on a steady empty loop over 3 hours", () => {
		const out = fire(
			"polling_loop",
			input({ requests: poll(360, 0.5, () => true) }),
		);
		expect(out?.severity).toBe("costs");
		expect(out?.line).toContain("every 30 seconds");
		expect(out?.evidence[0]?.kind).toBe("series");
		expect(out?.handoff.commands).toEqual([]);
	});

	test("needs 80% empty: 8 of 10 fires, 7 of 10 does not", () => {
		const eight = poll(10, 7, (i) => i < 8);
		expect(fire("polling_loop", input({ requests: eight }))).not.toBeNull();
		const seven = poll(10, 7, (i) => i < 7);
		expect(fire("polling_loop", input({ requests: seven }))).toBeNull();
	});

	test("needs a steady interval", () => {
		const erratic = poll(
			10,
			7,
			() => true,
			(i) => (i % 2 === 0 ? 0 : 5 * MIN),
		);
		expect(fire("polling_loop", input({ requests: erratic }))).toBeNull();
	});

	test("needs an hour of duration: 60 minutes fires, 56 does not", () => {
		expect(
			fire("polling_loop", input({ requests: poll(7, 10, () => true) })),
		).not.toBeNull();
		expect(
			fire("polling_loop", input({ requests: poll(5, 14, () => true) })),
		).toBeNull();
	});

	test("needs at least 5 requests", () => {
		expect(
			fire("polling_loop", input({ requests: poll(4, 30, () => true) })),
		).toBeNull();
	});
});

describe("server_errors", () => {
	const failures = (n: number) =>
		Array.from({ length: n }, (_, i) => ({
			path: i === 0 ? "/v1/index/blocks" : "/v1/streams/events",
			status: 503,
			createdAt: at(50 - i),
		}));

	test("fires on exactly 3 server errors", () => {
		const out = fire("server_errors", input({ failed5xx: failures(3) }));
		expect(out?.severity).toBe("losing");
		expect(out?.lead.startsWith("Our fault, not yours.")).toBe(true);
		expect(out?.evidence[0]).toMatchObject({ kind: "table" });
	});

	test("does not fire on 2", () => {
		expect(fire("server_errors", input({ failed5xx: failures(2) }))).toBeNull();
	});

	test("ranks paths by failure count", () => {
		const out = fire("server_errors", input({ failed5xx: failures(5) }));
		const table = out?.evidence[0];
		expect(table?.kind === "table" && table.rows[0]).toEqual([
			"/v1/streams/events",
			4,
		]);
	});
});

describe("allowance_exhausted", () => {
	test("fires once a paid row exists this month", () => {
		const out = fire(
			"allowance_exhausted",
			input({
				allowance: {
					firstPaidAt: new Date("2026-10-06T09:30:00.000Z"),
					paidRows: 2_000_000,
					paidUsdMicros: 10_000_000n,
				},
			}),
		);
		expect(out?.severity).toBe("costs");
		expect(out?.line).toBe("The free 1M rows ran out on Oct 6");
		expect(out?.meta).toBe("$10.00 so far this month");
		expect(out?.impact).toBe(10);
	});

	test("does not fire inside the allowance", () => {
		expect(fire("allowance_exhausted", input())).toBeNull();
	});
});

describe("backfill", () => {
	const day = (over: Partial<AccountRuleInput["rowsByDay"][number]> = {}) => ({
		day: "2026-10-05",
		rows: 300_000,
		pages: 300,
		fullPages: 300,
		usdMicros: 1_500_000n,
		...over,
	});
	const withDay = (d: ReturnType<typeof day>, monthRows: number) =>
		input({
			monthRows,
			rowsByDay: [
				d,
				{
					day: "2026-10-09",
					rows: monthRows - d.rows,
					pages: 10,
					fullPages: 0,
					usdMicros: 0n,
				},
			],
		});

	test("fires on a big day of full pages", () => {
		const out = fire("backfill", withDay(day(), 900_000));
		expect(out?.severity).toBe("costs");
		expect(out?.line).toBe("Oct 5 was a backfill");
		expect(out?.body).toContain("Archive");
	});

	test("share must be strictly over 25%", () => {
		expect(
			fire("backfill", withDay(day({ rows: 250_000 }), 1_000_000)),
		).toBeNull();
		expect(
			fire("backfill", withDay(day({ rows: 250_100 }), 1_000_000)),
		).not.toBeNull();
	});

	test("90% of pages must be full: 270 of 300 fires, 269 does not", () => {
		expect(
			fire("backfill", withDay(day({ fullPages: 270 }), 900_000)),
		).not.toBeNull();
		expect(
			fire("backfill", withDay(day({ fullPages: 269 }), 900_000)),
		).toBeNull();
	});

	test("a tiny day is never a backfill", () => {
		const tiny = day({ rows: 3000, pages: 3, fullPages: 3 });
		expect(fire("backfill", withDay(tiny, 3500))).toBeNull();
	});

	test("does not fire without any rows this month", () => {
		expect(fire("backfill", input())).toBeNull();
	});
});

describe("cap_pace", () => {
	const cap = (over: Partial<AccountRuleInput["cap"]> = {}) =>
		input({
			cap: {
				monthlyCapCents: 10_000,
				spentMonthUsdMicros: 40_000_000n,
				last7dChargesUsdMicros: 70_000_000n,
				...over,
			},
		});

	test("fires when the 7-day average projects past the cap", () => {
		const out = fire("cap_pace", cap());
		expect(out?.severity).toBe("will_fail");
		expect(out?.handoff.commands).toEqual(["sl credits balance"]);
		expect(out?.line).toBe("On pace to hit your $100.00 cap by Oct 21");
	});

	test("does not fire when the projection stays under the cap", () => {
		expect(
			fire("cap_pace", cap({ last7dChargesUsdMicros: 14_000_000n })),
		).toBeNull();
	});

	test("does not fire without a cap, without spend, or once the cap is hit", () => {
		expect(fire("cap_pace", cap({ monthlyCapCents: null }))).toBeNull();
		expect(fire("cap_pace", cap({ last7dChargesUsdMicros: 0n }))).toBeNull();
		expect(
			fire("cap_pace", cap({ spentMonthUsdMicros: 100_000_000n })),
		).toBeNull();
	});

	test("ignores compute and storage caps: only the monthly cap counts", () => {
		expect(fire("cap_pace", cap({ monthlyCapCents: null }))).toBeNull();
	});
});

describe("credits_runway", () => {
	test("fires at exactly 7 days of runway", () => {
		const out = fire(
			"credits_runway",
			input({
				balanceUsdMicros: 70_000_000n,
				burnPerDayUsdMicros: 10_000_000n,
			}),
		);
		expect(out?.severity).toBe("will_fail");
		expect(out?.handoff.commands).toEqual(["sl credits buy"]);
		expect(out?.line).toBe("Credits run out in about 7 days");
	});

	test("does not fire just over 7 days", () => {
		expect(
			fire(
				"credits_runway",
				input({
					balanceUsdMicros: 70_100_000n,
					burnPerDayUsdMicros: 10_000_000n,
				}),
			),
		).toBeNull();
	});

	test("does not fire when nothing is burning", () => {
		expect(
			fire("credits_runway", input({ burnPerDayUsdMicros: 0n })),
		).toBeNull();
	});

	test("fires at zero balance", () => {
		const out = fire(
			"credits_runway",
			input({ balanceUsdMicros: 0n, burnPerDayUsdMicros: 1_000_000n }),
		);
		expect(out?.line).toBe("Credits run out in about 0 days");
	});
});

describe("hand-off prompts and copy", () => {
	test("every rule fired in this file", () => {
		const ids = new Set(collected.map((c) => c.rule));
		for (const r of ACCOUNT_RULES) expect(ids.has(r.id)).toBe(true);
	});

	test("no prompt contains code", () => {
		for (const insight of collected) {
			const prompt = insight.handoff.prompt;
			for (const banned of ["```", "`", "{", "=>", "function", "import"]) {
				expect(prompt, `${insight.rule}: ${banned}`).not.toContain(banned);
			}
			expect(prompt.length).toBeGreaterThan(40);
		}
	});

	test("no copy uses an em dash", () => {
		for (const insight of collected) {
			for (const text of [
				insight.line,
				insight.meta ?? "",
				insight.lead,
				insight.body,
				insight.handoff.prompt,
			]) {
				expect(text).not.toContain("—");
			}
		}
	});

	test("every command is an sl command", () => {
		for (const insight of collected) {
			for (const cmd of insight.handoff.commands)
				expect(cmd.startsWith("sl ")).toBe(true);
		}
	});
});
