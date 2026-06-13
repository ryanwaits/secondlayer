import { z } from "zod/v4";

// Parse comma-separated networks
const networksSchema = z.string().transform((val) => {
	const networks = val
		.split(",")
		.map((n) => n.trim())
		.filter(Boolean);
	const valid = ["mainnet", "testnet"];
	for (const n of networks) {
		if (!valid.includes(n)) {
			throw new Error(
				`Invalid network: ${n}. Must be one of: ${valid.join(", ")}`,
			);
		}
	}
	return networks as ("mainnet" | "testnet")[];
});

interface EnvSchemaOutput {
	DATABASE_URL?: string;
	/**
	 * Shared indexer DB (blocks/txs/events). Falls back to DATABASE_URL.
	 * Set this alongside TARGET_DATABASE_URL to enable dual-DB mode.
	 */
	SOURCE_DATABASE_URL?: string;
	/**
	 * Tenant DB (subgraph schemas + subgraphs table). Falls back to DATABASE_URL.
	 * Set this alongside SOURCE_DATABASE_URL to enable dual-DB mode.
	 */
	TARGET_DATABASE_URL?: string;
	NETWORK?: "mainnet" | "testnet";
	NETWORKS?: ("mainnet" | "testnet")[];
	LOG_LEVEL: "debug" | "info" | "warn" | "error";
	NODE_ENV: "development" | "production" | "test";
}

// Cast needed: z.preprocess / z.default create different _input vs _output types
// that z.ZodType<T> can't represent without explicit input type param
const envSchema: z.ZodType<EnvSchemaOutput> = z.object({
	DATABASE_URL: z.preprocess(
		(val) => (typeof val === "string" && val.length === 0 ? undefined : val),
		z.string().url().optional(),
	),
	SOURCE_DATABASE_URL: z.preprocess(
		(val) => (typeof val === "string" && val.length === 0 ? undefined : val),
		z.string().url().optional(),
	),
	TARGET_DATABASE_URL: z.preprocess(
		(val) => (typeof val === "string" && val.length === 0 ? undefined : val),
		z.string().url().optional(),
	),
	NETWORK: z.enum(["mainnet", "testnet"]).optional(),
	NETWORKS: networksSchema.optional(),
	LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
}) as unknown as z.ZodType<EnvSchemaOutput>;

export type Env = EnvSchemaOutput & {
	enabledNetworks: ("mainnet" | "testnet")[];
};

let cachedEnv: Env | null = null;

export function getEnv(): Env {
	if (cachedEnv) {
		return cachedEnv;
	}

	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		console.error("❌ Invalid environment configuration:");
		console.error(z.treeifyError(result.error));
		throw new Error("Invalid environment configuration");
	}

	// Compute enabled networks from NETWORKS or NETWORK
	let enabledNetworks: ("mainnet" | "testnet")[];
	if (result.data.NETWORKS && result.data.NETWORKS.length > 0) {
		enabledNetworks = result.data.NETWORKS;
	} else if (result.data.NETWORK) {
		enabledNetworks = [result.data.NETWORK];
	} else {
		enabledNetworks = ["mainnet"]; // Default
	}

	cachedEnv = { ...result.data, enabledNetworks };
	return cachedEnv;
}

/**
 * True when `NODE_ENV=production`, read at RUNTIME — the single source of truth
 * for prod-vs-dev branching in this package.
 *
 * Why a helper instead of inlining `process.env.NODE_ENV === "production"`:
 * bunup/esbuild constant-folds the dot-access `process.env.NODE_ENV` to its
 * BUILD-time value. `@secondlayer/shared` is consumed by other services as its
 * built `dist`, so an inlined check freezes to a literal in the shipped bundle
 * (e.g. `const isProd = false`) and silently ignores the container's real
 * NODE_ENV. The bracket access below is NOT folded, so it stays a runtime read.
 * Route every prod check through here so the footgun lives in exactly one place.
 */
export function isProductionEnv(): boolean {
	// biome-ignore lint/complexity/useLiteralKeys: bracket access is deliberate — dot-access gets constant-folded by the bundler, freezing this to a build-time literal in the shipped dist.
	return process.env["NODE_ENV"] === "production";
}

/**
 * PoX-4 stacking decoder is ON by default — `/v1/index/stacking` is part of the
 * public surface, so the decoder that fills `pox4_calls` runs unless explicitly
 * opted out with `POX4_DECODER_ENABLED=false` (mirrors the sBTC decoder policy).
 */
export function isPox4DecoderEnabled(): boolean {
	return process.env.POX4_DECODER_ENABLED !== "false";
}

// Export for testing
export { envSchema };
