import { afterAll, describe, expect, test } from "bun:test";
import type { Answer } from "@secondlayer/shared/classify";
import { getDb, jsonb } from "@secondlayer/shared/db";
import { type ClassifyDeps, classifyNewTickets } from "./feedback-classify.ts";

const db = getDb();
const accountIds: string[] = [];
const ticketIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: `fb-${crypto.randomUUID()}@test.local`, ghost: false })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

async function makeTicket(
	accountId: string,
	over: {
		attempted?: Record<string, unknown>;
		status?: "new" | "classified";
		route?: string;
		createdAt?: Date;
	} = {},
): Promise<string> {
	const row = await db
		.insertInto("feedback_tickets")
		.values({
			account_id: accountId,
			intent: "need a sender filter",
			origin: "api",
			attempted: over.attempted
				? jsonb<Record<string, unknown>>(over.attempted)
				: null,
			status: over.status ?? "new",
			route: over.route ?? null,
			created_at: over.createdAt,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	ticketIds.push(row.id);
	return row.id;
}

afterAll(async () => {
	if (ticketIds.length > 0) {
		await db
			.deleteFrom("feedback_tickets")
			.where("id", "in", ticketIds)
			.execute();
	}
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

function answers(choice: string, confidence = 0.95) {
	return {
		kind: {
			type: "choice",
			choice,
			probabilities: { [choice]: confidence },
			confidence,
		} as Answer,
		risk: {
			type: "score",
			score: 0,
			probabilities: { "0": 1 },
			confidence: 0.9,
		} as Answer,
		has_chain_evidence: {
			type: "boolean",
			probability: 0,
			confidence: 0.9,
		} as Answer,
	};
}

function fakeDeps(
	result: ReturnType<typeof answers> | null,
	provider: "jev" | "rules" = "jev",
): ClassifyDeps & { calls: number } {
	const deps = {
		calls: 0,
		classifyFn: (async () => {
			deps.calls++;
			return result
				? { provider: "jev", modelId: "fake", answers: result }
				: null;
		}) as unknown as ClassifyDeps["classifyFn"],
		resolveProviderFn: (() => ({
			name: provider,
			modelId: provider,
		})) as ClassifyDeps["resolveProviderFn"],
	};
	return deps;
}

async function load(id: string) {
	return db
		.selectFrom("feedback_tickets")
		.selectAll()
		.where("id", "=", id)
		.executeTakeFirstOrThrow();
}

// The table is shared; drain pre-existing new rows so counts are exact.
async function drain() {
	await classifyNewTickets({ deps: fakeDeps(null, "rules") });
}

describe("classifyNewTickets", () => {
	test("rules-decided ticket skips the classifier", async () => {
		await drain();
		const acct = await makeAccount();
		const id = await makeTicket(acct, {
			attempted: { code: "INVALID_COLUMN" },
		});
		const deps = fakeDeps(answers("docs_mismatch"));
		await classifyNewTickets({ deps });
		const row = await load(id);
		expect(row.status).toBe("classified");
		expect(row.route).toBe("schema_gap");
		expect(row.classification?.rules_hit).toBe("missing_column");
		expect(deps.calls).toBe(0);
	});

	test("undecided ticket takes the confident model kind and stores probabilities", async () => {
		await drain();
		const acct = await makeAccount();
		const id = await makeTicket(acct);
		await classifyNewTickets({ deps: fakeDeps(answers("docs_mismatch")) });
		const row = await load(id);
		expect(row.route).toBe("docs");
		const stored = row.classification as {
			answers: { kind: { probabilities: Record<string, number> } };
		};
		expect(stored.answers.kind.probabilities.docs_mismatch).toBe(0.95);
	});

	test("classifier failure fails open to human", async () => {
		await drain();
		const acct = await makeAccount();
		const id = await makeTicket(acct);
		await classifyNewTickets({ deps: fakeDeps(null) });
		const row = await load(id);
		expect(row.route).toBe("human");
		expect(row.classification?.reason).toBe("fail_open");
	});

	test("rules provider never calls the classifier and routes to human", async () => {
		await drain();
		const acct = await makeAccount();
		const id = await makeTicket(acct);
		const deps = fakeDeps(answers("docs_mismatch"), "rules");
		await classifyNewTickets({ deps });
		expect(deps.calls).toBe(0);
		expect((await load(id)).route).toBe("human");
	});

	test("already classified tickets are left untouched", async () => {
		await drain();
		const acct = await makeAccount();
		const id = await makeTicket(acct, { status: "classified", route: "docs" });
		await classifyNewTickets({ deps: fakeDeps(answers("schema_gap")) });
		const row = await load(id);
		expect(row.route).toBe("docs");
		expect(row.classification).toBeNull();
		expect(row.classified_at).toBeNull();
	});

	test("limit routes only the oldest new ticket", async () => {
		await drain();
		const acct = await makeAccount();
		const older = await makeTicket(acct, {
			createdAt: new Date(Date.now() - 2000),
		});
		const newer = await makeTicket(acct, {
			createdAt: new Date(Date.now() - 1000),
		});
		const n = await classifyNewTickets({
			limit: 1,
			deps: fakeDeps(answers("docs_mismatch")),
		});
		expect(n).toBe(1);
		expect((await load(older)).status).toBe("classified");
		expect((await load(newer)).status).toBe("new");
	});

	test("concurrent runs route each ticket exactly once", async () => {
		await drain();
		const acct = await makeAccount();
		const ids = await Promise.all([
			makeTicket(acct),
			makeTicket(acct),
			makeTicket(acct),
		]);
		const [a, b] = await Promise.all([
			classifyNewTickets({
				limit: 5,
				deps: fakeDeps(answers("docs_mismatch")),
			}),
			classifyNewTickets({
				limit: 5,
				deps: fakeDeps(answers("docs_mismatch")),
			}),
		]);
		expect(a + b).toBe(3);
		for (const id of ids) expect((await load(id)).status).toBe("classified");
	});
});
