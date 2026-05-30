import { readFile } from "node:fs/promises";
import { DEFAULT_BTC_CONFIRMATIONS } from "@secondlayer/shared";
import { DEFAULT_STREAMS_BULK_PREFIX } from "./paths.ts";
import {
	DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS,
	requireNonNegativeInteger,
	requirePositiveInteger,
} from "./range.ts";

export type StreamsBulkRuntimeConfig = {
	network: string;
	prefix: string;
	rangeSizeBlocks: number;
	/**
	 * Bitcoin confirmations the streams-bulk publisher requires before a Stacks
	 * height counts as final — the same burn-confirmation boundary the Streams
	 * read path uses. Replaces the legacy `STREAMS_BULK_FINALITY_LAG_BLOCKS`
	 * (144 Stacks-block lag), which is no longer read on the streams path.
	 */
	btcConfirmations: number;
	outputDir: string;
};

export function getStreamsBulkRuntimeConfigFromEnv(
	overrides: Partial<StreamsBulkRuntimeConfig> = {},
): StreamsBulkRuntimeConfig {
	return {
		network: overrides.network ?? process.env.STREAMS_BULK_NETWORK ?? "mainnet",
		prefix:
			overrides.prefix ??
			process.env.STREAMS_BULK_PREFIX ??
			DEFAULT_STREAMS_BULK_PREFIX,
		rangeSizeBlocks: requirePositiveInteger(
			overrides.rangeSizeBlocks ??
				parseIntegerEnv(
					"STREAMS_BULK_RANGE_SIZE_BLOCKS",
					DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS,
				),
			"rangeSizeBlocks",
		),
		btcConfirmations: requireNonNegativeInteger(
			overrides.btcConfirmations ??
				parseIntegerEnv(
					"STREAMS_BULK_BTC_CONFIRMATIONS",
					DEFAULT_BTC_CONFIRMATIONS,
				),
			"btcConfirmations",
		),
		outputDir:
			overrides.outputDir ??
			process.env.STREAMS_BULK_OUTPUT_DIR ??
			"tmp/streams-bulk",
	};
}

export async function readIndexerProducerVersion(): Promise<string> {
	try {
		const packageJson = JSON.parse(
			await readFile(new URL("../../package.json", import.meta.url), "utf8"),
		) as { name?: string; version?: string };
		return `${packageJson.name ?? "@secondlayer/indexer"}@${
			packageJson.version ?? "unknown"
		}`;
	} catch {
		return "@secondlayer/indexer@unknown";
	}
}

function parseIntegerEnv(name: string, fallback: number): number {
	const value = process.env[name];
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed)) {
		throw new Error(`${name} must be an integer`);
	}
	return parsed;
}
