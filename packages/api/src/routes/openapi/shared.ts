/**
 * Helpers and shared fragments for the OpenAPI description. Each tag's paths
 * live in their own file beside this one; `../openapi.ts` assembles them.
 */
/** `contract_id` on the two consume-able feeds accepts a comma-separated set,
 *  so one cursor can follow a whole protocol. */
export const CONTRACT_ID_PARAM = qp(
	"contract_id",
	"string",
	false,
	"Contract principal, or a comma-separated set of up to 20 (e.g. `SP1.sbtc-token,SP1.sbtc-registry`). Mutually exclusive with `trait`.",
);

/**
 * Auth, as the shipped code enforces it (`src/auth/read-plane.ts`,
 * `src/middleware/auth-modes.ts`, `src/middleware/csrf.ts`).
 *
 * `/v1` reads: `security: [{}, { bearerAuth: [] }]` — anonymous OR bearer.
 * OpenAPI has no way to say "required depending on how the operator bound the
 * socket", and that is exactly the shipped rule: keyless while the API is
 * reachable only over loopback, instance token required once it is published
 * past loopback. Declaring the bearer *required* would describe a 401 that
 * never happens on the default self-host bind; declaring no `security` at all
 * would hide that a token is ever needed. Optional-bearer is the only one of
 * the three that generates a client with an optional token, which is the real
 * surface. The prose says which half of the rule applies when.
 */
export const READ_SECURITY = [{}, { bearerAuth: [] }];

/** Cursor and height window, shared by every Index list (`_shared.ts`
 *  `parseIndexBaseQuery`). With none of them, a read covers the last day. */
export const INDEX_RANGE_PARAMS = [
	{
		...qp(
			"cursor",
			"string",
			false,
			"`<block_height>:<event_index>` from a previous page's `next_cursor`. Resumes after it.",
		),
		schema: { type: "string", example: "7960000:3" },
	},
	qp(
		"from_cursor",
		"string",
		false,
		"Same as `cursor`. Mutually exclusive with it and with `from_height`.",
	),
	qp(
		"from_height",
		"integer",
		false,
		"First block height to read. Mutually exclusive with a cursor. With neither, the read starts one day behind the tip.",
	),
	qp("to_height", "integer", false, "Last block height to read, inclusive."),
];

/** Long-poll: `/v1/index/events` and `/v1/index/blocks` only —
 *  not every Index list, so this stays separate from `INDEX_RANGE_PARAMS`
 *  rather than overclaiming support on routes that don't wire it. */
export const WAIT_PARAM = qp(
	"wait",
	"integer",
	false,
	"Seconds (max 25) to hold the response open when there's nothing new past your cursor/from_height, instead of answering immediately. Returns early the moment new data commits, or at the timeout — either way you get a normal response, just later. Omit for the old poll-and-retry behavior.",
);

/** `/api` writes: the instance token is required whenever one is set, and an
 *  instance reachable past loopback refuses to boot without one. */
export const WRITE_SECURITY = [{ bearerAuth: [] }];

export const AUTH_DESCRIPTION =
	"Auth on this instance is the token minted by `secondlayer init` (`INSTANCE_TOKEN`), sent as `Authorization: Bearer $INSTANCE_TOKEN`. `/v1` reads need no credential while the API is reachable only over loopback and require the token on every request once it is published past loopback: one rule, identical on Index, Streams, and Subgraphs, which is why every read below lists bearer auth as optional. Writes under `/api` require the token whenever one is set, and must send `Content-Type: application/json` (anything else is refused with 415 `UNSUPPORTED_MEDIA_TYPE`). Hosted `api.secondlayer.tools` uses an account key; see https://www.secondlayer.tools/docs/authentication.";

export function qp(
	name: string,
	type: string,
	required = false,
	description?: string,
) {
	return {
		name,
		in: "query",
		required,
		schema: { type },
		...(description ? { description } : {}),
	};
}

export function pp(name: string, description?: string) {
	return {
		name,
		in: "path",
		required: true,
		schema: { type: "string" },
		...(description ? { description } : {}),
	};
}

/** Every `/v1` read can 401: the credential is optional on a loopback bind and
 *  required once the instance is reachable past it. */
export function ok(
	success: Record<string, unknown> = {
		description: "OK",
		content: { "application/json": {} },
	},
) {
	return {
		"200": success,
		"400": jsonError(ERROR_400),
		"401": jsonError(ERROR_401),
	};
}

/** Reads under `/api`. The instance token is required whenever one is set, and
 *  GET is not subject to the JSON content-type guard. */
export function apiReadResponses(extra: Record<string, unknown> = {}) {
	return {
		"200": { description: "OK", content: { "application/json": {} } },
		"401": jsonError(ERROR_401),
		...extra,
	};
}

/**
 * Writes under `/api`. 415 is `middleware/csrf.ts`: a write must declare
 * `Content-Type: application/json`, the one header a browser cannot set
 * cross-origin without a preflight this API's CORS policy gets to refuse.
 * Body-less action writes (`/stop`, `/pause`, `/rotate-secret`) are allowed
 * without the header only when they also carry no `Origin`, so first-party
 * callers should send it unconditionally.
 */
export function writeResponses(extra: Record<string, unknown> = {}) {
	return {
		"200": { description: "OK", content: { "application/json": {} } },
		"400": jsonError(ERROR_400),
		"401": jsonError(ERROR_401),
		"415": jsonError(
			"Missing or non-JSON `Content-Type` (`UNSUPPORTED_MEDIA_TYPE`) — writes must send `Content-Type: application/json`",
		),
		...extra,
	};
}

export function jsonBody(schema: Record<string, unknown>) {
	return {
		required: true,
		content: { "application/json": { schema } },
	};
}

export function json200(schema: Record<string, unknown>, description = "OK") {
	return {
		description,
		content: { "application/json": { schema } },
	};
}

/**
 * Index/Streams list envelope. `arrayKey` is the route's real row key
 * (`blocks`, `transactions`, …); `item` is the row schema, a bare object
 * until that route's resource schema is written (plan 041).
 */
export function envelope(
	arrayKey = "events",
	item: Record<string, unknown> = { type: "object" },
) {
	return {
		"200": {
			description: "Cursor-paginated envelope",
			content: {
				"application/json": {
					schema: {
						type: "object",
						required: [arrayKey, "next_cursor", "tip"],
						properties: {
							[arrayKey]: { type: "array", items: item },
							next_cursor: {
								type: ["string", "null"],
								description:
									"The last row's cursor. Pass it back as `cursor` to continue; a short page means you are at the tip. `null` when the page is empty.",
								example: "7960000:42",
							},
							tip: { $ref: "#/components/schemas/Tip" },
							reorgs: {
								type: "array",
								description:
									"Reorgs that touched this page's height range. Reconcile anything you committed from a fork.",
								items: { $ref: "#/components/schemas/Reorg" },
							},
						},
					},
				},
			},
		},
		"400": jsonError(ERROR_400),
		"401": jsonError(ERROR_401),
		"429": jsonError(ERROR_429),
	};
}

/** What each shared error status means, so no response reads just "Error". */
export const ERROR_400 =
	"A parameter, filter, cursor or body field was refused; `code` says which";
export const ERROR_401 =
	"This bind requires the instance token, and it was missing or wrong";
export const ERROR_404 = "Not found";
export const ERROR_429 = "Rate limited; retry after `Retry-After` seconds";

export function jsonError(description: string) {
	return {
		description,
		content: {
			"application/json": {
				schema: { $ref: "#/components/schemas/Error" },
			},
		},
	};
}
