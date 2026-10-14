import tips from "@/generated/tips.json";

/** What a tip shows. Never a link: `route` and `anchor` only let a tip light its row on that reference page. */
export type Tip = {
	kind: "method" | "type" | "endpoint";
	summary: string;
	/** Methods: one line from the first overload. */
	sig?: string;
	/** Types: the first fields. */
	fields?: { name: string; type: string }[];
	/** Fields past the ones listed. */
	more?: number;
	route: string;
	anchor: string;
};

export type TipTable = {
	symbols: Record<string, Tip>;
	endpoints: { path: string; method: string; tip: Tip }[];
};

/** `bun run docs:tips` writes this file from the generated reference and the OpenAPI description. */
export const tipTable = tips as unknown as TipTable;
