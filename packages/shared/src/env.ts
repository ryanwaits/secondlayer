import { z } from "zod";

// Parse comma-separated networks
const networksSchema = z.string().transform((val) => {
  const networks = val.split(",").map((n) => n.trim()).filter(Boolean);
  const valid = ["mainnet", "testnet"];
  for (const n of networks) {
    if (!valid.includes(n)) {
      throw new Error(`Invalid network: ${n}. Must be one of: ${valid.join(", ")}`);
    }
  }
  return networks as ("mainnet" | "testnet")[];
});

const envSchema = z.object({
  // DATABASE_URL is optional - consumers must provide their own
  DATABASE_URL: z.preprocess(
    (val) => (typeof val === "string" && val.length === 0) ? undefined : val,
    z.string().url().optional(),
  ),
  // Single network (deprecated, for backwards compatibility)
  NETWORK: z.enum(["mainnet", "testnet"]).optional(),
  // Multiple networks (comma-separated)
  NETWORKS: networksSchema.optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema> & {
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
    console.error(result.error.format());
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

// Export for testing
export { envSchema };
