import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	Index,
	type IndexContractCall,
	type IndexEvent,
	resolveBaseUrl,
} from "@secondlayer/sdk";
import {
	DECODED_EVENT_TYPES,
	type DecodedEventType,
} from "@secondlayer/stacks/filters";
import {
	type EventTrace,
	type SubgraphTestResult,
	runSubgraphTest as applySubgraphTest,
} from "@secondlayer/subgraphs/testing";
import { error, info, printError, success, warn } from "../lib/output.ts";
import { indexReadFailure } from "./subgraph-test.ts";

/**
 * `secondlayer subgraphs preview` — show IN/OUT for N real Index events.
 * Reuses the shared test run (`trace: true`); fetch is the same Index client
 * as `subgraphs test`, bounded by `--sample` instead of a cassette.
 */

type CassetteRow = IndexEvent | IndexContractCall;

function eventTypeFor(filter: { type: string }): DecodedEventType | null {
	if (filter.type === "contract_deploy") return null;
	const candidate = filter.type === "print_event" ? "print" : filter.type;
	return DECODED_EVENT_TYPES.includes(candidate as DecodedEventType)
		? (candidate as DecodedEventType)
		: null;
}

/** Format one event's IN/OUT lines (exported for unit tests). */
export function formatEventTrace(t: EventTrace): string[] {
	const block =
		t.blockHeight !== undefined ? `block ${t.blockHeight}` : "block ?";
	const tx = t.txId !== undefined ? `tx ${t.txId}` : "tx ?";
	const lines = [`${block}  ${tx}  source=${t.source}`];
	lines.push(`  IN   { ${t.inKeys.length > 0 ? t.inKeys.join(", ") : ""} }`);
	if (t.outs.length === 0) {
		lines.push("  OUT  (no insert)");
	} else {
		for (const o of t.outs) {
			lines.push(
				`  OUT  ${o.table} ← { ${o.keys.length > 0 ? o.keys.join(", ") : ""} }`,
			);
		}
	}
	return lines;
}

/** Render the full preview report. */
export function formatPreviewReport(result: SubgraphTestResult): string[] {
	const lines: string[] = [];
	for (const t of result.traces ?? []) {
		lines.push(...formatEventTrace(t));
	}
	if (result.unusedInKeys && result.unusedInKeys.length > 0) {
		lines.push(
			`warn: fields present in every IN and never in any OUT: ${result.unusedInKeys.join(", ")}`,
		);
	}
	return lines;
}

export interface SubgraphPreviewOptions {
	from?: string;
	to?: string;
	sample?: string;
}

export async function runSubgraphPreview(
	file: string,
	options: SubgraphPreviewOptions,
): Promise<void> {
	const absPath = resolve(file);
	if (!existsSync(absPath)) {
		error(`File not found: ${absPath}`);
		process.exit(1);
	}
	if (!options.from) {
		error("--from <height> is required (Index reads are metered).");
		process.exit(1);
	}

	const fromHeight = Number(options.from);
	const toHeight = options.to ? Number(options.to) : fromHeight + 100;
	if (!Number.isInteger(fromHeight) || !Number.isInteger(toHeight)) {
		error("--from/--to must be integers.");
		process.exit(1);
	}
	const sample = options.sample ? Number(options.sample) : 10;
	if (!Number.isInteger(sample) || sample < 1) {
		error("--sample must be a positive integer.");
		process.exit(1);
	}

	const { readFile } = await import("node:fs/promises");
	const { bundleSubgraphCode } = await import("@secondlayer/bundler");

	const source = await readFile(absPath, "utf8");
	const bundled = await bundleSubgraphCode(source);
	const sources = (bundled.sources ?? {}) as Record<
		string,
		{
			type: string;
			contractId?: string | string[];
			topic?: string;
			functionName?: string;
			materialize?: unknown;
		}
	>;

	const mod = (await import(`${absPath}?t=${Date.now()}`)) as {
		default?: {
			handlers?: Record<string, unknown>;
			schema?: unknown;
			sources?: Record<string, unknown>;
		};
	};
	const def = mod.default;
	if (!def?.schema) {
		error(
			"File must default-export a defineSubgraph() definition with schema.",
		);
		process.exit(1);
	}
	const handlers = (def.handlers ?? {}) as Record<string, unknown>;

	const index = new Index();
	const events: Record<string, CassetteRow[]> = {};
	let sourcesTested = 0;
	for (const [name, filter] of Object.entries(sources)) {
		if (filter.type === "contract_call") {
			sourcesTested++;
			info(
				`Fetching ${name} (contract_call) blocks ${fromHeight}–${toHeight} (sample ${sample})…`,
			);
			try {
				const envelope = await index.contractCalls.list({
					...(filter.contractId
						? {
								contractId: Array.isArray(filter.contractId)
									? filter.contractId
									: filter.contractId,
							}
						: {}),
					...(filter.functionName ? { functionName: filter.functionName } : {}),
					fromHeight,
					toHeight,
					limit: sample,
				});
				events[name] = envelope.contract_calls.slice(0, sample);
			} catch (err) {
				const failure = indexReadFailure(err, {
					source: name,
					fromHeight,
					toHeight,
					apiUrl: resolveBaseUrl(),
					file,
				});
				printError(failure.message, { hint: failure.hint });
				process.exit(1);
			}
			continue;
		}

		const eventType = eventTypeFor(filter);
		if (eventType === null) {
			warn(
				filter.type === "contract_deploy"
					? `source "${name}" (contract_deploy) has no Index list endpoint — skipped.`
					: `source "${name}" (${filter.type}) is not readable from Index — skipped.`,
			);
			continue;
		}
		sourcesTested++;
		info(
			`Fetching ${name} (${eventType}) blocks ${fromHeight}–${toHeight} (sample ${sample})…`,
		);
		try {
			const envelope = await index.events.list({
				eventType,
				...(filter.contractId
					? {
							contractId: Array.isArray(filter.contractId)
								? filter.contractId
								: filter.contractId,
						}
					: {}),
				fromHeight,
				toHeight,
				limit: sample,
			});
			events[name] = envelope.events.slice(0, sample);
		} catch (err) {
			const failure = indexReadFailure(err, {
				source: name,
				fromHeight,
				toHeight,
				apiUrl: resolveBaseUrl(),
				file,
			});
			printError(failure.message, { hint: failure.hint });
			process.exit(1);
		}
	}

	if (sourcesTested === 0) {
		error(
			"No sources were tested — every source is unreadable from Index (e.g. contract_deploy has no list endpoint).",
		);
		process.exit(1);
	}

	const result = await applySubgraphTest({
		schema: def.schema as Parameters<typeof applySubgraphTest>[0]["schema"],
		handlers,
		sources: sources as Parameters<typeof applySubgraphTest>[0]["sources"],
		events: events as Parameters<typeof applySubgraphTest>[0]["events"],
		trace: true,
	});

	info("");
	for (const line of formatPreviewReport(result)) {
		if (line.startsWith("warn:")) warn(line.slice("warn: ".length));
		else info(line);
	}
	info("");

	if (result.code === "NO_EVENTS") {
		warn(
			result.hint ??
				`No events matched these sources in blocks ${fromHeight}–${toHeight}.`,
		);
		return;
	}
	if (result.code === "EMPTY_MAPPING" || !result.ok) {
		error(
			result.hint ?? "At least one matched event wrote 0 rows — empty mapping.",
		);
		process.exit(1);
	}
	success(
		`${result.matched} event${result.matched === 1 ? "" : "s"} → ${result.written} row${result.written === 1 ? "" : "s"} (preview sample)`,
	);
}
