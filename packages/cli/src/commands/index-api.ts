import { Index } from "@secondlayer/sdk";
import type { Command } from "commander";
import { error as logError, note, output, writeData } from "../lib/output.ts";
import { resolveEnvKey } from "../lib/resolve-auth.ts";

const DEFAULT_BASE_URL = "https://api.secondlayer.tools";

/**
 * Index reads allow anonymous access, but free-tier API keys are rejected
 * (Build+ required). So the key is optional: pass it through when present,
 * and translate the 403 into an actionable hint.
 */
function client(): Index {
	return new Index({
		baseUrl: process.env.SL_API_URL ?? DEFAULT_BASE_URL,
		apiKey: resolveEnvKey(),
	});
}

function fail(action: string, err: unknown): never {
	const message = err instanceof Error ? err.message : String(err);
	logError(`Failed to ${action}: ${message}`);
	if (/\b403\b/.test(message) || /forbidden/i.test(message)) {
		note(
			"The Index API requires a Build+ tier key (free-tier keys are rejected).",
		);
	}
	process.exit(1);
}

type ListOptions = {
	contractId?: string;
	sender?: string;
	recipient?: string;
	assetIdentifier?: string;
	functionName?: string;
	eventType?: string;
	fromHeight?: string;
	toHeight?: string;
	cursor?: string;
	limit?: string;
	json?: boolean;
};

/** Shared numeric/string param coercion for the height-paginated endpoints. */
function rangeParams(o: ListOptions) {
	return {
		contractId: o.contractId,
		fromHeight: o.fromHeight ? Number.parseInt(o.fromHeight, 10) : undefined,
		toHeight: o.toHeight ? Number.parseInt(o.toHeight, 10) : undefined,
		cursor: o.cursor,
		limit: o.limit ? Number.parseInt(o.limit, 10) : undefined,
	};
}

function emit(env: { next_cursor: string | null }, json?: boolean): void {
	output({
		json,
		data: env,
		human: () => {
			writeData(JSON.stringify(env, null, 2));
			if (env.next_cursor) note(`next_cursor: ${env.next_cursor}`);
		},
	});
}

export function registerIndexCommand(program: Command): void {
	const index = program
		.command("index")
		.description("Query the decoded Index layer (L2 events + contract calls)");

	const rangeFlags = (cmd: Command): Command =>
		cmd
			.option("--contract-id <id>", "Filter by contract id")
			.option("--from-height <n>", "Start block height (inclusive)")
			.option("--to-height <n>", "End block height (inclusive)")
			.option("--cursor <cursor>", "Resume token from a previous next_cursor")
			.option("--limit <n>", "Rows per page")
			.option("--json", "Print the full envelope as JSON");

	rangeFlags(index.command("ft-transfers"))
		.description("List decoded SIP-010 fungible-token transfers")
		.option("--sender <principal>", "Filter by sender")
		.option("--recipient <principal>", "Filter by recipient")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().ftTransfers.list({
						...rangeParams(o),
						sender: o.sender,
						recipient: o.recipient,
					}),
					o.json,
				);
			} catch (err) {
				fail("list ft transfers", err);
			}
		});

	rangeFlags(index.command("nft-transfers"))
		.description("List decoded SIP-009 non-fungible-token transfers")
		.option("--sender <principal>", "Filter by sender")
		.option("--recipient <principal>", "Filter by recipient")
		.option("--asset-identifier <id>", "Filter by asset identifier")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().nftTransfers.list({
						...rangeParams(o),
						sender: o.sender,
						recipient: o.recipient,
						assetIdentifier: o.assetIdentifier,
					}),
					o.json,
				);
			} catch (err) {
				fail("list nft transfers", err);
			}
		});

	rangeFlags(index.command("events"))
		.description(
			"List decoded events by type (stx_*, ft/nft mint/burn, print, …)",
		)
		.requiredOption("--event-type <type>", "Decoded event type (required)")
		.option("--sender <principal>", "Filter by sender")
		.option("--recipient <principal>", "Filter by recipient")
		.option("--asset-identifier <id>", "Filter by asset identifier")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().events.list({
						// biome-ignore lint/suspicious/noExplicitAny: event_type is validated server-side
						eventType: o.eventType as any,
						...rangeParams(o),
						sender: o.sender,
						recipient: o.recipient,
						assetIdentifier: o.assetIdentifier,
					}),
					o.json,
				);
			} catch (err) {
				fail("list events", err);
			}
		});

	rangeFlags(index.command("contract-calls"))
		.description("List decoded contract calls (function, args, result)")
		.option("--function-name <name>", "Filter by called function")
		.option("--sender <principal>", "Filter by caller")
		.action(async (o: ListOptions) => {
			try {
				emit(
					await client().contractCalls.list({
						...rangeParams(o),
						functionName: o.functionName,
						sender: o.sender,
					}),
					o.json,
				);
			} catch (err) {
				fail("list contract calls", err);
			}
		});
}
