import type {
	InferredTopicSchema,
	SubgraphDefinition,
} from "@secondlayer/subgraphs";

/**
 * Deploy-time print-field lint: cross-check `.data.<field>` reads in
 * print_event handler code against the empirically observed print schema for
 * the source's contract. Purely advisory — deploys never fail on a warning,
 * and any schema-lookup failure silently skips the lint (the chain index may
 * lag or the contract may be brand new).
 */

/** Identifier after `.data.` — matches how handlers read decoded print fields. */
const DATA_FIELD_ACCESS = /\.data\.([A-Za-z_$][\w$]*)/g;

/** Tip-free print-schema source; the API injects the cached getPrintSchemaBody. */
export type PrintSchemaLookup = (
	contractId: string,
) => Promise<{ topics: InferredTopicSchema[] }>;

export async function lintPrintFields(
	def: Pick<SubgraphDefinition, "sources" | "handlers">,
	schemaLookup: PrintSchemaLookup,
): Promise<string[]> {
	const warnings: string[] = [];
	for (const [sourceName, filter] of Object.entries(def.sources ?? {})) {
		if (filter?.type !== "print_event") continue;
		// Trait sources span many contracts and unpinned sources span all of
		// them — only a single pinned contract has one observable schema.
		if (!filter.contractId || filter.trait) continue;
		const handler = def.handlers?.[sourceName] ?? def.handlers?.["*"];
		if (typeof handler !== "function") continue;

		let topics: InferredTopicSchema[];
		try {
			topics = (await schemaLookup(filter.contractId)).topics;
		} catch {
			continue;
		}
		if (topics.length === 0) continue;

		const relevant = filter.topic
			? topics.filter((t) => t.topic === filter.topic)
			: topics;
		// Declared topic never observed → nothing to lint against.
		if (relevant.length === 0) continue;

		// Handlers see camelized keys on e.data, plus the topic discriminant.
		const known = new Set<string>(["topic"]);
		for (const topic of relevant) {
			for (const field of topic.fields) known.add(field.camel_name);
		}

		const topicList = relevant.map((t) => t.topic).join(", ");
		const seen = new Set<string>();
		for (const match of handler.toString().matchAll(DATA_FIELD_ACCESS)) {
			const ident = match[1];
			if (ident === undefined || known.has(ident) || seen.has(ident)) continue;
			seen.add(ident);
			warnings.push(
				`print_event source "${sourceName}": field "${ident}" never observed on topic(s) ${topicList} of ${filter.contractId}`,
			);
		}
	}
	return warnings;
}
