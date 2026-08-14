/**
 * Minimal runtime config — six or fewer required non-secret values.
 * Unknown or contradictory values fail before ingest starts.
 */

export const NODE_MODES = ["external", "stacks", "full"] as const;
export type NodeMode = (typeof NODE_MODES)[number];

export const NETWORKS = ["mainnet", "testnet", "devnet"] as const;
export type RuntimeNetwork = (typeof NETWORKS)[number];

/** Required non-secret keys. Secrets (tokens, signing keys) come from `sl init`. */
export const REQUIRED_KEYS = [
	"NETWORK",
	"DATABASE_URL",
	"NODE_MODE",
	"DATA_DIR",
	"API_PORT",
	"INDEXER_PORT",
] as const;
export type RequiredConfigKey = (typeof REQUIRED_KEYS)[number];

export const OPTIONAL_KEYS = [
	"STACKS_NODE_RPC_URL",
	"LISTEN_HOST",
	"LOG_LEVEL",
	"INSTANCE_MODE",
] as const;

export const SECRET_KEYS = [
	"INSTANCE_TOKEN",
	"API_KEY",
	"SECONDLAYER_SECRETS_KEY",
	"STREAMS_SIGNING_PRIVATE_KEY",
	"SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY",
	"POSTGRES_PASSWORD",
	"BITCOIN_RPC_PASSWORD",
] as const;

export type RuntimeConfig = {
	NETWORK: RuntimeNetwork;
	DATABASE_URL: string;
	NODE_MODE: NodeMode;
	DATA_DIR: string;
	API_PORT: number;
	INDEXER_PORT: number;
	STACKS_NODE_RPC_URL: string | null;
	LISTEN_HOST: string;
	LOG_LEVEL: string;
};

export type ConfigResult =
	| { ok: true; config: RuntimeConfig }
	| { ok: false; errors: string[] };

const KNOWN = new Set<string>([
	...REQUIRED_KEYS,
	...OPTIONAL_KEYS,
	...SECRET_KEYS,
	"SOURCE_DATABASE_URL",
	"TARGET_DATABASE_URL",
	"INSTANCE_MODE",
	"NODE_ENV",
	"ALLOW_UNSIGNED_WEBHOOKS",
	"OBSERVER_JOURNAL_ENABLED",
	"STACKS_NETWORK",
]);

export function parseRuntimeConfig(
	env: Record<string, string | undefined>,
): ConfigResult {
	const errors: string[] = [];
	for (const key of Object.keys(env)) {
		if (env[key] === undefined) continue;
		if (key.startsWith("SL_") || key.startsWith("POSTGRES_")) continue;
		if (!KNOWN.has(key) && isRuntimeish(key)) {
			errors.push(`unknown config ${key}`);
		}
	}

	const network = (env.NETWORK ?? env.STACKS_NETWORK ?? "").trim();
	if (!isNetwork(network)) {
		errors.push("NETWORK must be mainnet | testnet | devnet");
	}
	const database = (env.DATABASE_URL ?? "").trim();
	if (!database) errors.push("DATABASE_URL is required");
	const mode = (env.NODE_MODE ?? "").trim();
	if (!isNodeMode(mode)) {
		errors.push("NODE_MODE must be external | stacks | full");
	}
	const dataDir = (env.DATA_DIR ?? "/data").trim();
	const apiPort = parsePort(env.API_PORT ?? "3800", "API_PORT", errors);
	const indexerPort = parsePort(
		env.INDEXER_PORT ?? "3700",
		"INDEXER_PORT",
		errors,
	);

	if (mode === "external" && env.BITCOIN_RPC_PASSWORD) {
		errors.push("NODE_MODE=external contradicts BITCOIN_RPC_PASSWORD");
	}
	if (mode === "full" && !env.BITCOIN_RPC_PASSWORD) {
		errors.push("NODE_MODE=full requires BITCOIN_RPC_PASSWORD");
	}
	if (mode === "stacks" && env.BITCOIN_RPC_PASSWORD) {
		errors.push(
			"NODE_MODE=stacks uses public Bitcoin; drop BITCOIN_RPC_PASSWORD",
		);
	}

	if (errors.length > 0) return { ok: false, errors };
	return {
		ok: true,
		config: {
			NETWORK: network as RuntimeNetwork,
			DATABASE_URL: database,
			NODE_MODE: mode as NodeMode,
			DATA_DIR: dataDir,
			API_PORT: apiPort,
			INDEXER_PORT: indexerPort,
			STACKS_NODE_RPC_URL: env.STACKS_NODE_RPC_URL?.trim() || null,
			LISTEN_HOST: env.LISTEN_HOST?.trim() || "0.0.0.0",
			LOG_LEVEL: env.LOG_LEVEL?.trim() || "info",
		},
	};
}

function isNetwork(value: string): value is RuntimeNetwork {
	return (NETWORKS as readonly string[]).includes(value);
}

function isNodeMode(value: string): value is NodeMode {
	return (NODE_MODES as readonly string[]).includes(value);
}

function isRuntimeish(key: string): boolean {
	return /^[A-Z][A-Z0-9_]+$/.test(key);
}

function parsePort(raw: string, name: string, errors: string[]): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1 || n > 65535) {
		errors.push(`${name} must be a TCP port`);
		return 0;
	}
	return n;
}
