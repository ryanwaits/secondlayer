import {
	type ArchivePartition,
	type LoadedArchive,
	SecondLayer,
	resolveAccountKey,
} from "@secondlayer/sdk";
import type { Command } from "commander";
import {
	ARCHIVE_GATE_NOT_CONFIGURED_MESSAGE,
	type ArchiveFlow,
	formatInsufficientMessage,
	quoteArchiveFetch,
} from "../lib/archive-gate.ts";
import { resolveArchiveOpsUrl } from "../lib/http.ts";
import { formatKeyValue, note, output, printError } from "../lib/output.ts";
import { attachBootstrapCommand } from "./bootstrap.ts";
import { attachRepairCommand } from "./repair.ts";
import { attachVerifyCommand } from "./verify.ts";

const ARCHIVE_KEY_HINT =
	"set SECONDLAYER_API_KEY (sk-sl_*) for archive latest/quote; INSTANCE_TOKEN is the instance";

type ArchiveOps = {
	latest(against?: string): Promise<LoadedArchive>;
	load(against: string): Promise<LoadedArchive>;
	partitions(
		ref: LoadedArchive,
		filter?: { fromBlock?: number; toBlock?: number },
	): ArchivePartition[];
};

/** Injectable seams for unit tests — production uses the real SDK + gate. */
export type ArchiveCommandDeps = {
	resolveAccountKey?: () => string | undefined;
	archive?: (accountKey: string) => ArchiveOps;
	quoteArchiveFetch?: typeof quoteArchiveFetch;
};

function parseHeight(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative integer, got "${value}"`);
	}
	return parsed;
}

function parseFlow(raw: string): ArchiveFlow {
	if (raw === "bootstrap" || raw === "repair") return raw;
	throw new Error(`--flow must be bootstrap or repair, got "${raw}"`);
}

function requireAccountKey(
	resolve: () => string | undefined = resolveAccountKey,
): string {
	const accountKey = resolve();
	if (!accountKey) {
		printError(ARCHIVE_KEY_HINT);
		process.exit(1);
	}
	return accountKey;
}

function defaultArchive(accountKey: string): ArchiveOps {
	return new SecondLayer({
		accountKey,
		archiveOpsUrl: resolveArchiveOpsUrl(),
	}).archive;
}

export async function runLatest(
	opts: { against?: string; json?: boolean },
	deps: ArchiveCommandDeps = {},
): Promise<void> {
	const accountKey = requireAccountKey(deps.resolveAccountKey);
	const archive = (deps.archive ?? defaultArchive)(accountKey);
	const loaded = await archive.latest(opts.against);
	const coverage = loaded.manifest.coverage;
	const fromBlock = coverage?.from_block ?? "unknown";
	const toBlock = coverage?.to_block ?? "unknown";
	const publishedAt =
		typeof loaded.manifest.published_at === "string"
			? loaded.manifest.published_at
			: undefined;
	const digest =
		typeof loaded.manifest.digest === "string"
			? loaded.manifest.digest
			: typeof loaded.manifest.sha256 === "string"
				? loaded.manifest.sha256
				: undefined;

	const data = {
		origin: loaded.origin,
		coverage: { from_block: fromBlock, to_block: toBlock },
		signature_verified: loaded.signature.verified,
		...(publishedAt ? { published_at: publishedAt } : {}),
		...(digest ? { digest } : {}),
	};

	output({
		json: opts.json,
		data,
		human: () => {
			const pairs: [string, string][] = [
				["Origin", loaded.origin],
				["Coverage", `${fromBlock}-${toBlock}`],
				["Signature", loaded.signature.verified ? "verified" : "unverified"],
			];
			if (publishedAt) pairs.push(["Published", publishedAt]);
			if (digest) pairs.push(["Digest", digest]);
			console.error(formatKeyValue(pairs));
		},
	});
}

export async function runQuote(
	opts: {
		against: string;
		fromBlock?: string;
		toBlock?: string;
		flow: string;
		json?: boolean;
	},
	deps: ArchiveCommandDeps = {},
): Promise<void> {
	const accountKey = requireAccountKey(deps.resolveAccountKey);
	const flow = parseFlow(opts.flow);
	const fromBlock =
		opts.fromBlock === undefined
			? undefined
			: parseHeight(opts.fromBlock, "--from-block");
	const toBlock =
		opts.toBlock === undefined
			? undefined
			: parseHeight(opts.toBlock, "--to-block");
	if (fromBlock !== undefined && toBlock !== undefined && toBlock < fromBlock) {
		printError("--to-block must be >= --from-block");
		process.exit(1);
	}

	const archive = (deps.archive ?? defaultArchive)(accountKey);
	const loaded = await archive.load(opts.against);
	const partitions = archive.partitions(loaded, { fromBlock, toBlock });
	if (partitions.length === 0) {
		printError("no partitions in range");
		process.exit(1);
	}

	const quoteFn = deps.quoteArchiveFetch ?? quoteArchiveFetch;
	const result = await quoteFn(
		partitions.map((p) => p.path),
		flow,
	);
	if (!result.ok) {
		if (result.kind === "not_authed") {
			printError(ARCHIVE_KEY_HINT);
			process.exit(1);
		}
		if (result.kind === "not_configured") {
			printError(ARCHIVE_GATE_NOT_CONFIGURED_MESSAGE);
			process.exit(1);
		}
		printError(result.message);
		process.exit(1);
	}

	const { quote } = result;
	output({
		json: opts.json,
		data: quote,
		human: () => {
			console.error(
				formatKeyValue([
					["Partitions", String(quote.partitions)],
					["Bundles", String(quote.bundles)],
					["USD", quote.usd],
					["Sufficient", quote.sufficient ? "yes" : "no"],
				]),
			);
			if (!quote.sufficient) {
				note(formatInsufficientMessage(quote));
			}
		},
	});

	if (!quote.sufficient) {
		process.exit(2);
	}
}

export function registerArchiveCommand(program: Command): void {
	const archive = program
		.command("archive")
		.description(
			"Verified chain history: bootstrap, verify, repair, price a fetch",
		);

	attachVerifyCommand(
		archive
			.command("verify")
			.description(
				"Compare local chain data against a signed archive (read-only; nothing is uploaded)",
			),
	);
	attachRepairCommand(
		archive
			.command("repair")
			.description(
				"Replace local chain data that diverges from a signed archive (dry-run by default)",
			),
	);
	attachBootstrapCommand(
		archive
			.command("bootstrap")
			.description(
				"Restore chain history from a verified archive instead of syncing from genesis",
			),
	);

	archive
		.command("quote")
		.description("Price a hosted archive fetch without charging")
		.requiredOption("--against <manifest>", "archive manifest: an https URL")
		.option("--from-block <n>", "first height to price")
		.option("--to-block <n>", "last height to price")
		.option(
			"--flow <bootstrap|repair>",
			"pricing flow (bootstrap or repair)",
			"bootstrap",
		)
		.option("--json", "Output as JSON")
		.action(
			async (opts: {
				against: string;
				fromBlock?: string;
				toBlock?: string;
				flow: string;
				json?: boolean;
			}) => {
				try {
					await runQuote(opts);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					printError(message);
					process.exit(1);
				}
			},
		);

	archive
		.command("latest")
		.description("Show the official archive tip (coverage, origin, signature)")
		.option(
			"--against <url>",
			"Override latest.json URL (default official tree)",
		)
		.option("--json", "Output as JSON")
		.action(async (opts: { against?: string; json?: boolean }) => {
			try {
				await runLatest(opts);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				printError(message);
				process.exit(1);
			}
		});
}
