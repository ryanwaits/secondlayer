export const HOSTED_BASE = "https://api.secondlayer.tools";
export const LOCAL_BASE = "http://127.0.0.1:3800";

export type Base = "hosted" | "local";

export const KEY_VAR = "$SECONDLAYER_API_KEY";

export const KEY_EXPR = "process.env.SECONDLAYER_API_KEY";

export const KEY_PLACEHOLDERS = [KEY_VAR, KEY_EXPR] as const;

/**
 * A sample that calls anything a docs key is refused on (Streams and Index are
 * all it reads): the `/api/*` management plane, subgraphs, feedback, and their
 * SDK namespaces. Filling the key in would hand the reader a failing command.
 */
const DOCS_KEY_REFUSED =
	/\/api\/|\/v1\/(?:subgraphs|feedback)\b|\.(?:webhooks|subgraphs|archive|feedback)\./;

export const docsKeyCanRun = (source: string) => !DOCS_KEY_REFUSED.test(source);

export const BASE_SWAPS = [
	[HOSTED_BASE, LOCAL_BASE],
	[KEY_VAR, "$INSTANCE_TOKEN"],
] as const;

export const KEY_SWAP = 1;
