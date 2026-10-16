import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { SubgraphDefinition, SubgraphFilter } from "../types.ts";
import {
	ERROR_GROUPS_CAP_PER_SUBGRAPH,
	type HandlerErrorInput,
	errorFingerprint,
	flushHandlerErrors,
	recordHandlerError,
	setHandlerErrorRecorder,
	topFrame,
} from "./error-groups.ts";
import { runHandlers } from "./runner.ts";
import type { MatchedTx } from "./source-matcher.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";

const HAS_DB = !!process.env.DATABASE_URL;

afterEach(() => {
	setHandlerErrorRecorder(null);
});

describe("errorFingerprint", () => {
	const base = {
		sourceName: "burns",
		eventType: "ft_burn",
		frame: "handlers.ts:42",
	};

	test("same bug at different heights and hex values shares a fingerprint", () => {
		const a = errorFingerprint({
			...base,
			message: "reading 'toString' of undefined at block 9218411 (0xabc123)",
		});
		const b = errorFingerprint({
			...base,
			message: "reading 'toString' of undefined at block 9218999 (0xdef4567)",
		});
		expect(a).toBe(b);
	});

	test("quoted strings are ignored", () => {
		const a = errorFingerprint({ ...base, message: "no column 'foo'" });
		const b = errorFingerprint({ ...base, message: "no column 'bar'" });
		expect(a).toBe(b);
	});

	test("different event type yields a different fingerprint", () => {
		const message = "boom";
		expect(errorFingerprint({ ...base, message })).not.toBe(
			errorFingerprint({ ...base, eventType: "ft_mint", message }),
		);
	});
});

describe("topFrame", () => {
	test("extracts basename:line from the first located stack line", () => {
		const err = new Error("boom");
		err.stack =
			"Error: boom\n    at handler (/srv/app/src/handlers.ts:42:13)\n    at run (/srv/app/runner.ts:9:1)";
		expect(topFrame(err)).toBe("handlers.ts:42");
	});

	test("also handles frames without a function name", () => {
		const err = new Error("boom");
		err.stack = "Error: boom\n    at /srv/app/handlers.ts:7:3";
		expect(topFrame(err)).toBe("handlers.ts:7");
	});

	test("returns null for a string throw", () => {
		expect(topFrame("just a string")).toBeNull();
	});
});

describe("runner integration", () => {
	function mockCtx(height = 100) {
		const calls: unknown[] = [];
		return {
			block: { height, hash: "0x", timestamp: 0, burnBlockHeight: 0 },
			tx: { txId: "", sender: "", type: "", status: "" },
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			setTx(tx: any) {
				this.tx = tx;
			},
			pendingOps: 0,
			opsCheckpoint() {
				return calls.length;
			},
			rollbackTo(checkpoint: number) {
				calls.length = checkpoint;
			},
			async flush() {
				return 0;
			},
		};
	}

	const sources: Record<string, SubgraphFilter> = {
		burns: { type: "ft_burn", assetIdentifier: "SP.token::tok" },
	};
	const sg: SubgraphDefinition = {
		name: "burner",
		// biome-ignore lint/suspicious/noExplicitAny: test fixture
		sources: sources as any,
		schema: { burns: { columns: { who: { type: "text" } } } },
		handlers: {
			burns: () => {
				throw new Error("handler exploded");
			},
		},
	};
	const matched: MatchedTx = {
		tx: {
			tx_id: "0xtx1",
			type: "contract_call",
			sender: "SP1",
			status: "success",
			contract_id: "SP.token",
			function_name: "burn",
		},
		events: [
			{
				id: "e1",
				tx_id: "0xtx1",
				type: "ft_burn",
				event_index: 0,
				data: {},
			},
		],
		sourceName: "burns",
	};

	test("records one group per failing event with its type and tx id", async () => {
		const recorded: HandlerErrorInput[] = [];
		setHandlerErrorRecorder(async (input) => {
			recorded.push(input);
		});

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await runHandlers(sg, [matched], mockCtx(77) as any);
		await Promise.resolve();

		expect(result.errors).toBe(1);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]).toMatchObject({
			subgraphName: "burner",
			sourceName: "burns",
			eventType: "ft_burn",
			txId: "0xtx1",
			blockHeight: 77,
		});
	});

	test("a rejecting recorder never breaks the block", async () => {
		setHandlerErrorRecorder(async () => {
			throw new Error("db down");
		});

		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const result = await runHandlers(sg, [matched], mockCtx() as any);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(result.errors).toBe(1);
	});
});

describe.skipIf(!HAS_DB)("recordHandlerError (db)", () => {
	const subgraphName = `test-error-groups-${crypto.randomUUID().slice(0, 8)}`;
	const input = (message: string, sourceName = "burns") => ({
		subgraphName,
		sourceName,
		eventType: "ft_burn",
		txId: "0xtx",
		blockHeight: 10,
		err: new Error(message),
	});

	async function cleanup() {
		await sql`DELETE FROM subgraph_error_groups WHERE subgraph_name = ${subgraphName}`.execute(
			getDb(),
		);
	}

	afterEach(cleanup);
	afterAll(cleanup);

	async function groups() {
		return getDb()
			.selectFrom("subgraph_error_groups")
			.selectAll()
			.where("subgraph_name", "=", subgraphName)
			.execute();
	}

	test("1000 identical errors coalesce into one row with count 1000", async () => {
		for (let i = 0; i < 1000; i++) recordHandlerError(input("same failure"));
		await flushHandlerErrors();

		const rows = await groups();
		expect(rows).toHaveLength(1);
		expect(Number(rows[0]?.count)).toBe(1000);
	});

	test("a later flush adds to the existing row", async () => {
		recordHandlerError(input("same failure"));
		await flushHandlerErrors();
		recordHandlerError(input("same failure"));
		recordHandlerError(input("same failure"));
		await flushHandlerErrors();

		const rows = await groups();
		expect(rows).toHaveLength(1);
		expect(Number(rows[0]?.count)).toBe(3);
	});

	test("a different fingerprint gets a separate row", async () => {
		recordHandlerError(input("first failure"));
		recordHandlerError(input("second failure"));
		await flushHandlerErrors();

		const rows = await groups();
		expect(rows.map((r) => r.message).sort()).toEqual([
			"first failure",
			"second failure",
		]);
	});

	test("groups beyond the cap are trimmed after a flush", async () => {
		for (let i = 0; i < ERROR_GROUPS_CAP_PER_SUBGRAPH + 1; i++) {
			// Distinct source names give distinct fingerprints.
			recordHandlerError(input("boom", `source-${i}`));
		}
		await flushHandlerErrors();

		expect(await groups()).toHaveLength(ERROR_GROUPS_CAP_PER_SUBGRAPH);
	});
});
