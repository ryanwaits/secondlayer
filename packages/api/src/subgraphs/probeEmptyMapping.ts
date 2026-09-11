import { pathToFileURL } from "node:url";
import type {
	InferredTopicSchema,
	SubgraphDefinition,
} from "@secondlayer/subgraphs";
import { probeHandlers } from "@secondlayer/subgraphs/testing";
import type { PrintSchemaLookup } from "./print-lint.ts";

const DUMMY_PRINCIPAL = "SP000000000000000000002Q6VF78";

export type EmptyMappingProbeResult =
	| { ok: true; skipped: true }
	| { ok: true; skipped: false; matched: number; written: number }
	| {
			ok: false;
			code: "EMPTY_MAPPING";
			matched: number;
			written: 0;
			firstEventKeys?: string[];
	  }
	| { ok: false; code: "HANDLER_IMPORT_FAILED"; error: string };

/** Dummy `event.data` value for an observed print-schema field. */
export function dummyValueForColumnType(columnType: string): unknown {
	switch (columnType) {
		case "uint":
		case "int":
			return 1n;
		case "principal":
			return DUMMY_PRINCIPAL;
		case "boolean":
			return true;
		case "jsonb":
			return {};
		case "timestamp":
			return 0;
		default:
			return "x";
	}
}

/** Synthesize minimal print `data` from always_present fields only. */
export function synthesizePrintData(
	fields: Array<{
		camel_name: string;
		column_type: string;
		always_present: boolean;
	}>,
): Record<string, unknown> {
	const data: Record<string, unknown> = {};
	for (const field of fields) {
		if (!field.always_present) continue;
		data[field.camel_name] = dummyValueForColumnType(field.column_type);
	}
	return data;
}

/**
 * True when matched events wrote 0 rows after the processor has actually run.
 * Uses already-fetched table rowCounts — no extra COUNT.
 */
export function isEmptyMappingHealth(input: {
	totalProcessed: number;
	totalRows: number;
}): boolean {
	return input.totalProcessed > 0 && input.totalRows === 0;
}

function pinnedPrintSources(def: Pick<SubgraphDefinition, "sources">): Array<{
	name: string;
	contractId: string | readonly string[];
	topic?: string;
}> {
	const out: Array<{
		name: string;
		contractId: string | readonly string[];
		topic?: string;
	}> = [];
	for (const [name, filter] of Object.entries(def.sources ?? {})) {
		if (filter?.type !== "print_event") continue;
		if (!filter.contractId || filter.trait) continue;
		out.push({
			name,
			contractId: filter.contractId,
			...(filter.topic ? { topic: filter.topic } : {}),
		});
	}
	return out;
}

function topicsForSource(
	topics: InferredTopicSchema[],
	topicFilter?: string,
): InferredTopicSchema[] {
	if (!topicFilter) return topics;
	return topics.filter((t) => t.topic === topicFilter);
}

/**
 * Import the already-written handler file (same path the processor uses) and
 * probe pinned print sources against dummy observed fields. No Index reads.
 */
export async function probeEmptyMapping(input: {
	def: Pick<SubgraphDefinition, "sources" | "schema">;
	handlerPath: string;
	schemaLookup: PrintSchemaLookup;
}): Promise<EmptyMappingProbeResult> {
	const pinned = pinnedPrintSources(input.def);
	if (pinned.length === 0) {
		return { ok: true, skipped: true };
	}

	let handlers: Record<string, unknown>;
	let schema: SubgraphDefinition["schema"];
	let sources: SubgraphDefinition["sources"];
	try {
		const mod = (await import(pathToFileURL(input.handlerPath).href)) as {
			default?: {
				handlers?: Record<string, unknown>;
				schema?: SubgraphDefinition["schema"];
				sources?: SubgraphDefinition["sources"];
			};
		};
		const loaded = mod.default;
		if (!loaded?.handlers || !loaded.schema || !loaded.sources) {
			return {
				ok: false,
				code: "HANDLER_IMPORT_FAILED",
				error:
					"Bundled module must default-export defineSubgraph() with handlers, schema, and sources.",
			};
		}
		handlers = loaded.handlers;
		schema = loaded.schema;
		sources = loaded.sources;
	} catch (err) {
		return {
			ok: false,
			code: "HANDLER_IMPORT_FAILED",
			error: err instanceof Error ? err.message : String(err),
		};
	}

	const samples: Array<{ source: string; event: Record<string, unknown> }> = [];
	for (const source of pinned) {
		const contractIds = Array.isArray(source.contractId)
			? source.contractId
			: [source.contractId];
		let topics: InferredTopicSchema[];
		try {
			const perContract = await Promise.all(
				contractIds.map(async (id) => (await input.schemaLookup(id)).topics),
			);
			topics = perContract.flat();
		} catch {
			continue;
		}
		const relevant = topicsForSource(topics, source.topic);
		if (relevant.length === 0) continue;

		for (const topic of relevant) {
			samples.push({
				source: source.name,
				event: {
					topic: topic.topic,
					contractId: Array.isArray(source.contractId)
						? source.contractId[0]
						: source.contractId,
					data: synthesizePrintData(topic.fields),
				},
			});
		}
	}

	if (samples.length === 0) {
		return { ok: true, skipped: true };
	}

	const result = await probeHandlers(
		{
			schema,
			sources: sources as Record<string, { type: string }>,
			handlers,
		},
		samples,
	);

	if (result.matched > 0 && result.written === 0) {
		return {
			ok: false,
			code: "EMPTY_MAPPING",
			matched: result.matched,
			written: 0,
			...(result.firstEventKeys
				? { firstEventKeys: result.firstEventKeys }
				: {}),
		};
	}

	return {
		ok: true,
		skipped: false,
		matched: result.matched,
		written: result.written,
	};
}
