import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitTransactions } from "@secondlayer/stacks/transactions";
import { txidFromBytes } from "@secondlayer/stacks/utils";
import { generateSubgraphSQL } from "@secondlayer/subgraphs/schema";
import { pinPreimage } from "@secondlayer/subgraphs/verification";
import {
	type ReplayDeps,
	loadDeterministicDefinition,
	replayBlocks,
} from "@secondlayer/subgraphs/verify";
import {
	type BlockVerification,
	type StateWrite,
	parseNakamotoHeader,
	unhex,
} from "@secondlayer/verify";
import {
	type VerifySubgraphDeps,
	type VerifySubgraphOptions,
	runVerifySubgraph,
} from "./verify-subgraph.ts";

// Every block "verifies" through an injected verifier; its transactions are
// mainnet block 8,199,502's, and its writes are named below.

const POOL = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-vault-v2-01";
const uintHex = (n: bigint) => `01${n.toString(16).padStart(32, "0")}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const TXS = (() => {
	const raw = unhex(
		readFileSync(
			join(import.meta.dir, "../../../verify/test/fixtures/blocks/8199502.hex"),
			"utf8",
		).trim(),
	);
	const body = raw.subarray(parseNakamotoHeader(raw).byteLength);
	return splitTransactions(body.subarray(4), 2).map((t) => ({
		txid: txidFromBytes(t),
		raw: t,
	}));
})();

const CHAIN: Record<number, [bigint, bigint][]> = {
	100: [[1n, 10n]],
	101: [
		[2n, 7n],
		[1n, 12n],
	],
	102: [],
};

function verified(height: number): BlockVerification {
	const id = sha(`block ${height}`);
	const writes: StateWrite[] = (CHAIN[height] ?? []).map(([k, v], ordinal) => ({
		ordinal,
		tx_index: 0,
		key: `vm::${POOL}::0::reserve::${uintHex(k)}`,
		value_hex: Buffer.from(`0a${uintHex(v)}`, "utf8").toString("hex"),
	}));
	return {
		ok: true,
		height,
		blockId: id,
		blockHash: sha(id),
		consensusHash: "ab".repeat(20),
		timestamp: 1_700_000_000,
		burnHeight: 900_000,
		transactions: TXS,
		diff: { named: true, writes: [], carried: [], internal: [] },
		writes,
		notes: [],
		failures: [],
	};
}

const bundle = (body: string) => `
var subgraph_default = {
	name: "pool-reserves",
	startBlock: 100,
	sources: { reserve: { type: "map_set", contractId: "${POOL}", map: "reserve" } },
	schema: {
		reserves: {
			columns: { token: { type: "principal" }, amount: { type: "uint" } },
			uniqueKeys: [["token"]],
		},
	},
	handlers: { reserve: (event, ctx) => { ${body} } },
};
export { subgraph_default as default };
`;
const CLEAN = bundle(
	'ctx.upsert("reserves", { token: String(event.key) }, { amount: event.value });',
);

async function pinFor(code: string) {
	const def = await loadDeterministicDefinition(code);
	const preimage = pinPreimage({
		schemaHash: generateSubgraphSQL(def).hash,
		handlerCode: code,
		startBlock: 100,
		network: "mainnet",
	});
	return { pin: sha(preimage), pinPreimage: preimage };
}

/** What the served table holds after an honest run over CHAIN. */
async function honestRows(): Promise<Record<string, unknown>[]> {
	const r = await replayBlocks(
		{ verify: async (h) => verified(h), burnHeightHint: async () => 0 },
		{ handlerCode: CLEAN, from: 100, to: 102 },
	);
	return (r.tables.get("reserves") ?? []).map((row, i) => ({
		...row,
		amount: String(row.amount),
		_id: String(i + 1),
		_created_at: "2026-10-09T00:00:00Z",
	}));
}

interface Setup {
	level?: "state" | "events";
	code?: string;
	pin?: { pin: string | null; pinPreimage: string | null };
	rows?: Record<string, unknown>[];
	tip?: number;
	verify?: (h: number) => Promise<BlockVerification>;
}

async function run(setup: Setup, opts: VerifySubgraphOptions = {}) {
	const code = setup.code ?? CLEAN;
	const pin = setup.pin ?? (await pinFor(code));
	const rows = setup.rows ?? (await honestRows());
	const fake: ReplayDeps = {
		verify: setup.verify ?? (async (h) => verified(h)),
		burnHeightHint: async () => 0,
	};
	const deps: VerifySubgraphDeps = {
		fetchSubgraph: async () => ({
			verification:
				setup.level === "events"
					? {
							level: "events",
							reasons: ['print_event source "s" needs event proofs'],
							unproven: [],
						}
					: {
							level: "state",
							reasons: [],
							unproven: [
								"tx attribution of writes: event.tx, _tx_id (needs event proofs)",
							],
						},
			definition: { startBlock: 100 },
		}),
		fetchSource: async () => ({ handlerCode: code, ...pin }),
		fetchRows: async () => ({
			rows,
			next_cursor: null,
			tip: { subgraph_height: setup.tip ?? 102 },
		}),
		replay: (o) => replayBlocks(fake, o),
	};
	let stdout = "";
	let stderr = "";
	const write = process.stdout.write;
	const error = console.error;
	process.stdout.write = ((chunk: string) => {
		stdout += chunk;
		return true;
	}) as typeof process.stdout.write;
	console.error = (...args: unknown[]) => {
		stderr += `${args.join(" ")}\n`;
	};
	try {
		const code = await runVerifySubgraph(
			"pool-reserves",
			{ replay: true, ...opts },
			deps,
		);
		return { code, lines: stdout.trim().split("\n"), stderr };
	} finally {
		process.stdout.write = write;
		console.error = error;
	}
}

describe("verify subgraph --replay", () => {
	test("a clean range: every link holds, exit 0", async () => {
		const r = await run({});
		expect(r.code).toBe(0);
		const { pin } = await pinFor(CLEAN);
		expect(r.lines).toEqual([
			`✓ pin       ${pin.slice(0, 4)}…${pin.slice(-4)}  handler, schema and startBlock match the deploy`,
			"✓ blocks    3 proven from the checkpoint",
			"✓ txs       6 transactions match their blocks' tx merkle roots",
			"✓ inputs    3 diffs fully named; 3 writes to amm-vault-v2-01",
			"✓ handlers  3 events, 0 handler errors, deterministic realm",
			expect.stringMatching(
				/^✓ rows {6}reserves: 2 equal {2}digest [0-9a-f]{4}…[0-9a-f]{4}$/,
			),
			"✓ pool-reserves 100..102 recomputed from proven inputs. Trusted: only the checkpoint (Stacks 8,956,304, Bitcoin 967,680).",
			"  unproven: tx attribution of writes: event.tx, _tx_id (needs event proofs)",
		]);
		expect(r.stderr).toContain("Replaying pool-reserves 100..102 (3 blocks)");
	});

	test("a tampered served row breaks the rows link, exit 1", async () => {
		const rows = await honestRows();
		(rows[0] as Record<string, unknown>).amount = "13";
		const r = await run({ rows });
		expect(r.code).toBe(1);
		expect(r.lines[5]).toBe(
			'✗ rows      reserves ["1"]: amount served 13, replayed 12',
		);
		expect(r.lines.at(-1)).toBe("✗ Not proven: the rows link is broken.");
	});

	test("a dropped write breaks the inputs link, exit 1", async () => {
		const r = await run({
			verify: async (h) => {
				const v = verified(h);
				if (h !== 101) return v;
				return {
					...v,
					ok: false,
					failures: [
						{
							step: "names",
							code: "hidden-write",
							message: "leaf 9f is not a named write",
						},
					],
				};
			},
		});
		expect(r.code).toBe(1);
		expect(r.lines[3]).toBe(
			"✗ inputs    block 101: leaf 9f is not a named write",
		);
		expect(r.lines[4]).toBe(
			"· handlers  not checked: an earlier link is broken",
		);
	});

	test("Date.now() in the handler breaks the handlers link, exit 1", async () => {
		const code = bundle(
			'ctx.insert("reserves", { token: "x", amount: BigInt(Date.now()) });',
		);
		const r = await run({ code });
		expect(r.code).toBe(1);
		expect(r.lines[4]).toStartWith(
			"✗ handlers  block 100 NondeterminismError: Date",
		);
	});

	test("an events-level subgraph is not replayable, exit 2", async () => {
		const r = await run({ level: "events" });
		expect(r.code).toBe(2);
		expect(r.stderr).toContain(
			'pool-reserves is level events, not state: print_event source "s" needs event proofs',
		);
	});

	test("--to past the served subgraph's height, exit 2", async () => {
		const r = await run({ tip: 101 }, { to: "102" });
		expect(r.code).toBe(2);
		expect(r.stderr).toContain(
			"--to 102 is past the served subgraph: it is at 101",
		);
	});

	test("a deploy without a stored preimage leaves the pin unchecked, and still replays", async () => {
		const r = await run({ pin: { pin: null, pinPreimage: null } });
		expect(r.code).toBe(0);
		expect(r.lines[0]).toBe(
			"· pin       not checked: deployed before pin inputs were stored (redeploy)",
		);
	});

	test("--json prints the replay summary and comparison, tables as row counts", async () => {
		const r = await run({}, { json: true });
		expect(r.code).toBe(0);
		const out = JSON.parse(r.lines.join("\n"));
		expect(out.pin.status).toBe("ok");
		expect(out.replay).toMatchObject({
			ok: true,
			blocks: 3,
			tables: { reserves: 2 },
		});
		expect(out.comparison.tables[0]).toMatchObject({
			table: "reserves",
			equal: 2,
		});
	});
});

describe("verify subgraph on the command line", () => {
	const cli = join(import.meta.dir, "../cli.ts");
	const spawn = async (...args: string[]) => {
		const proc = Bun.spawn([process.execPath, "run", cli, ...args], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, NO_COLOR: "1" },
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, code };
	};

	test("help lists the links, what stays unproven, metering, examples and exit codes", async () => {
		const r = await spawn("verify", "subgraph", "--help");
		expect(r.code).toBe(0);
		for (const text of [
			"pin       the served pin",
			"rows      the served rows equal the recomputed ones",
			"Not proven: which transaction made a write",
			"Nothing bills as Index rows",
			"$ secondlayer verify subgraph pool-reserves --replay",
			"2  could not check",
		])
			expect(r.stdout).toContain(text);
	});

	test("without --replay there is nothing to check: exit 2 before any read", async () => {
		const r = await spawn("verify", "subgraph", "pool-reserves");
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("pass --replay");
	});
});
