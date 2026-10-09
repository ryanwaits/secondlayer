import type { SubgraphDetail } from "@secondlayer/shared/schemas/subgraphs";
import { deriveVerification } from "@secondlayer/subgraphs/verification";
import {
	type PinCheck,
	type ReplayFailure,
	type ReplayOptions,
	type ReplayResult,
	type ReplayStep,
	type RowComparison,
	checkPin,
	compareRows,
	loadDeterministicDefinition,
	replayContracts,
	replaySubgraph,
} from "@secondlayer/subgraphs/verify";
import {
	MAINNET_CHECKPOINT,
	type ProofSource,
	parseNakamotoHeader,
	unhex,
} from "@secondlayer/verify";
import type { Command } from "commander";
import {
	getSubgraphApi,
	getSubgraphRowsApi,
	getSubgraphSourceApi,
} from "../lib/api-client.ts";
import { dim, green, note, printError, red, writeData } from "../lib/output.ts";
import { defaultSource } from "./verify-block.ts";
import { VERIFY_EXIT } from "./verify.ts";

/**
 * `secondlayer verify subgraph <name> --replay`: re-run a state-level
 * subgraph's handlers over block inputs proven from the checkpoint and check
 * the served rows against the result.
 *
 * Exit codes follow `secondlayer verify`:
 *   0  every link holds
 *   1  a link is broken (the first one is named)
 *   2  could not check: the source could not serve a link, the replay is
 *      inconclusive, the subgraph is not state-level, or bad input
 */

export interface VerifySubgraphOptions {
	replay?: boolean;
	from?: string;
	to?: string;
	/** Stacks node RPC for blocks and MARF proofs (self-host). */
	node?: string;
	json?: boolean;
}

type Rows = Record<string, unknown>[];

export interface VerifySubgraphDeps {
	source?: ProofSource;
	/** The replay itself; defaults to `replaySubgraph` over `source`. */
	replay?: (opts: ReplayOptions) => Promise<ReplayResult>;
	fetchSubgraph?: (
		name: string,
	) => Promise<Pick<SubgraphDetail, "verification" | "definition">>;
	fetchSource?: (name: string) => Promise<{
		handlerCode?: string | null;
		pin?: string | null;
		pinPreimage?: string | null;
	}>;
	fetchRows?: (
		name: string,
		table: string,
		cursor?: string,
	) => Promise<{
		rows: Rows;
		next_cursor: string | null;
		tip: { subgraph_height: number };
	}>;
}

const LINKS: { step: ReplayStep; label: string }[] = [
	{ step: "pin", label: "pin" },
	{ step: "blocks", label: "blocks" },
	{ step: "txs", label: "txs" },
	{ step: "inputs", label: "inputs" },
	{ step: "handlers", label: "handlers" },
	{ step: "rows", label: "rows" },
];
const LABEL_WIDTH = Math.max(...LINKS.map((l) => l.label.length));
const PROGRESS_EVERY = 100;
const PAGE = 1000;

const n = (v: number) => v.toLocaleString("en-US");
const short = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;

class InputError extends Error {}

function parseHeight(
	raw: string | undefined,
	flag: string,
): number | undefined {
	if (raw === undefined) return undefined;
	if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
		throw new InputError(`${flag} must be a block height, got "${raw}"`);
	return Number(raw);
}

/** Every row of a served table, following cursors. */
async function readTable(
	fetchRows: NonNullable<VerifySubgraphDeps["fetchRows"]>,
	name: string,
	table: string,
): Promise<Rows> {
	const out: Rows = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await fetchRows(name, table, cursor);
		out.push(...page.rows);
		if (!page.next_cursor || page.rows.length === 0) return out;
		cursor = page.next_cursor;
	}
}

interface Report {
	name: string;
	pin: PinCheck;
	pinValue: string | null;
	result?: ReplayResult;
	comparison?: RowComparison;
	contracts: string[];
	unproven: string[];
}

function linkLine(step: ReplayStep, r: Report): string {
	const res = r.result as ReplayResult;
	switch (step) {
		case "pin":
			return `${short(r.pinValue ?? "")}  handler, schema and startBlock match the deploy`;
		case "blocks":
			return `${n(res.blocks)} proven from the checkpoint${
				res.marfProofs
					? ` (${n(res.marfProofs)} MARF proof${res.marfProofs === 1 ? "" : "s"}, then parent links)`
					: ""
			}`;
		case "txs":
			return `${n(res.txs)} transactions match their blocks' tx merkle roots`;
		case "inputs":
			return `${n(res.blocks)} diffs fully named; ${n(res.writes)} writes to ${r.contracts
				.map((c) => c.split(".")[1] ?? c)
				.join(", ")}`;
		case "handlers":
			return `${n(res.events)} events, ${n(res.handlerErrors)} handler errors, deterministic realm`;
		case "rows":
			return (r.comparison?.tables ?? [])
				.map(
					(t) =>
						`${t.table}: ${n(t.equal)} equal${
							t.superseded
								? `, ${n(t.superseded)} superseded after ${n(res.to)}`
								: ""
						}  digest ${short(t.digest)}`,
				)
				.join(`\n${" ".repeat(LABEL_WIDTH + 4)}`);
	}
}

function firstFailure(r: Report): ReplayFailure | undefined {
	if (r.pin.status === "failed") return r.pin.failure;
	return r.result?.failures[0] ?? r.comparison?.failures[0];
}

/** One line per link, then the verdict. Returns the exit code. */
function report(r: Report, from: number, to: number): number {
	const first = firstFailure(r);
	const broken = first
		? LINKS.findIndex((l) => l.step === first.step)
		: LINKS.length;
	const inconclusive = !first ? r.result?.inconclusive : undefined;
	for (const [i, link] of LINKS.entries()) {
		const label = link.label.padEnd(LABEL_WIDTH);
		if (first && i === broken)
			writeData(`${red("✗")} ${label}  ${first.message}`);
		else if (i > broken)
			writeData(dim(`· ${label}  not checked: an earlier link is broken`));
		else if (link.step === "pin" && r.pin.status === "unchecked")
			writeData(
				dim(
					`· ${label}  not checked: deployed before pin inputs were stored (redeploy)`,
				),
			);
		else if (link.step === "rows" && inconclusive)
			writeData(dim(`· ${label}  not checked: ${inconclusive}`));
		else writeData(`${green("✓")} ${label}  ${linkLine(link.step, r)}`);
	}
	for (const line of [...r.pin.notes, ...(r.result?.notes ?? [])])
		note(`  note: ${line}`);

	if (first) {
		const label = LINKS[broken]?.label ?? first.step;
		writeData(
			red(
				first.unavailable
					? `✗ Could not check the ${label} link: the source could not serve it.`
					: `✗ Not proven: the ${label} link is broken.`,
			),
		);
		return first.unavailable ? VERIFY_EXIT.UNANCHORED : VERIFY_EXIT.DIVERGED;
	}
	if (inconclusive) {
		writeData(dim(`· Inconclusive: ${inconclusive}. Rows were not compared.`));
		return VERIFY_EXIT.UNANCHORED;
	}
	const cp = MAINNET_CHECKPOINT;
	const stacks = n(
		Number(parseNakamotoHeader(unhex(cp.stacks.header)).chainLength),
	);
	writeData(
		green(
			`✓ ${r.name} ${n(from)}..${n(to)} recomputed from proven inputs. Trusted: only the checkpoint (Stacks ${stacks}, Bitcoin ${n(cp.bitcoin.height)}).`,
		),
	);
	writeData(
		dim(
			`  unproven, so not compared: ${[...r.unproven, "rows compare declared columns and _block_height only"].join("; ")}`,
		),
	);
	return VERIFY_EXIT.CLEAN;
}

function reportJson(r: Report): string {
	const { tables, ...result } = r.result ?? ({} as ReplayResult);
	return JSON.stringify(
		{
			pin: r.pin,
			replay: r.result
				? {
						...result,
						tables: Object.fromEntries(
							[...(tables ?? new Map())].map(([t, rows]) => [t, rows.length]),
						),
					}
				: null,
			comparison: r.comparison ?? null,
		},
		(_k, v) => (typeof v === "bigint" ? v.toString() : v),
		2,
	);
}

/** Replay a subgraph and compare its rows. Returns the exit code. */
export async function runVerifySubgraph(
	name: string,
	opts: VerifySubgraphOptions,
	deps: VerifySubgraphDeps = {},
): Promise<number> {
	const fetchSubgraph = deps.fetchSubgraph ?? getSubgraphApi;
	const fetchSource = deps.fetchSource ?? getSubgraphSourceApi;
	const fetchRows =
		deps.fetchRows ??
		((n: string, t: string, cursor?: string) =>
			getSubgraphRowsApi(n, t, { cursor, limit: PAGE }));
	try {
		if (!opts.replay)
			throw new InputError(
				"pass --replay: the only check today re-runs the handlers over proven blocks",
			);
		const fromFlag = parseHeight(opts.from, "--from");
		const toFlag = parseHeight(opts.to, "--to");

		const detail = await fetchSubgraph(name);
		const level = detail.verification;
		if (level?.level !== "state")
			throw new InputError(
				level
					? `${name} is level ${level.level}, not state: ${level.reasons.join("; ")}`
					: `${name} has no verification level: deployed before levels were derived (redeploy)`,
			);
		const served = await fetchSource(name);
		if (!served.handlerCode)
			throw new InputError(
				`${name} has no stored handler bundle to replay (a local deploy)`,
			);
		const def = await loadDeterministicDefinition(served.handlerCode);
		const pin = checkPin(
			{
				pin: served.pin ?? null,
				pinPreimage: served.pinPreimage ?? null,
				handlerCode: served.handlerCode,
			},
			def,
		);
		const startBlock =
			typeof detail.definition?.startBlock === "number"
				? detail.definition.startBlock
				: (def.startBlock ?? 0);
		const contracts = replayContracts(def);
		const tables = Object.keys(def.schema);
		const first = tables[0]
			? await fetchRows(name, tables[0])
			: { tip: { subgraph_height: startBlock } };
		const tip = first.tip.subgraph_height;
		const from = fromFlag ?? startBlock;
		const to = toFlag ?? tip;
		if (to > tip)
			throw new InputError(
				`--to ${n(to)} is past the served subgraph: it is at ${n(tip)}`,
			);
		if (from > to)
			throw new InputError(`--from ${n(from)} is after --to ${n(to)}`);

		const r: Report = {
			name,
			pin,
			pinValue: served.pin ?? null,
			contracts: Array.isArray(contracts) ? contracts : [],
			// This runtime's own rules for what replay leaves unproven.
			unproven: deriveVerification(def).unproven,
		};
		if (pin.status !== "failed") {
			// Read the served tables first: the closer to `to`, the fewer rows
			// move under the comparison.
			const servedRows = new Map<string, Rows>();
			for (const table of tables)
				servedRows.set(table, await readTable(fetchRows, name, table));

			note(
				`Replaying ${name} ${n(from)}..${n(to)} (${n(to - from + 1)} blocks)`,
			);
			r.result = await (deps.replay ?? replaySubgraph)({
				source: deps.source ?? defaultSource(opts.node),
				handlerCode: served.handlerCode,
				from,
				to,
				startBlock,
				onProgress: (h) => {
					const done = h - from + 1;
					if (done % PROGRESS_EVERY === 0)
						note(`  replayed ${n(done)} / ${n(to - from + 1)} blocks`);
				},
			});
			if (r.result.failures.length === 0 && !r.result.inconclusive)
				r.comparison = compareRows(def.schema, r.result, servedRows);
		}
		if (opts.json) {
			writeData(reportJson(r));
			const f = firstFailure(r);
			if (f)
				return f.unavailable ? VERIFY_EXIT.UNANCHORED : VERIFY_EXIT.DIVERGED;
			return r.result?.inconclusive
				? VERIFY_EXIT.UNANCHORED
				: VERIFY_EXIT.CLEAN;
		}
		return report(r, from, to);
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err));
		return VERIFY_EXIT.UNANCHORED;
	}
}

export function attachVerifySubgraphCommand(verify: Command): Command {
	return verify
		.command("subgraph")
		.description(
			"Recompute a state-level subgraph from proven blocks and check its served rows",
		)
		.argument("<name>", "deployed subgraph name")
		.option(
			"--replay",
			"re-run the handlers over blocks proven from the checkpoint",
		)
		.option(
			"--from <height>",
			"first block to replay (default: the subgraph's startBlock)",
		)
		.option(
			"--to <height>",
			"last block to replay (default: the served subgraph's height)",
		)
		.option(
			"--node <url>",
			"read blocks and MARF proofs from this Stacks node RPC instead of the API",
		)
		.addHelpText(
			"after",
			`
What is proven, link by link:
  pin       the served pin is the sha256 of its preimage, which names the served
            handler bundle, its schema and startBlock
  blocks    every block in the range, from the checkpoint (signatures above it,
            parent links and MARF proofs below it)
  txs       each block's transactions hash to its header's tx merkle root
  inputs    each block's writes are named, nothing hidden (state_writes vs witness)
  handlers  the bundle runs in the deterministic realm over those writes
  rows      the served rows equal the recomputed ones (keyed by the first
            unique key, else as a multiset), with a digest per table

Starting after startBlock (--from) is inconclusive once a handler reads or
merges rows written before the range (findOne, increment, a partial upsert).
Not proven, so not compared: which transaction made a write (event.tx,
_tx_id) and writes overwritten within one block. Rows compare on their
declared columns and _block_height.

Reads are free: proofs and each block's state writes from /v1/proofs (rate
limited; witnesses 2 per second, so 1,000 blocks take 8 minutes or more) and
the subgraph's rows from /v1/subgraphs. Nothing bills as Index rows.

Examples:
  $ secondlayer verify subgraph pool-reserves --replay
  $ secondlayer verify subgraph pool-reserves --replay --from 1230000 --to 1231000
  $ secondlayer verify subgraph pool-reserves --replay --json

Exit codes:
  0  every link holds
  1  a link is broken (the first is named)
  2  could not check: the source could not serve a link, the replay is
     inconclusive, the subgraph is not state-level, or bad input`,
		)
		.action(async (name: string, opts: VerifySubgraphOptions, cmd: Command) => {
			const json = cmd.optsWithGlobals().json === true;
			process.exit(await runVerifySubgraph(name, { ...opts, json }));
		});
}
