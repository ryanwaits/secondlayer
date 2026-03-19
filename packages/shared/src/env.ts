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

interface EnvSchemaOutput {
  DATABASE_URL?: string;
  NETWORK?: "mainnet" | "testnet";
  NETWORKS?: ("mainnet" | "testnet")[];
  LOG_LEVEL: "debug" | "info" | "warn" | "error";
  NODE_ENV: "development" | "production" | "test";
}

// Cast needed: z.preprocess / z.default create different _input vs _output types
// that z.ZodType<T> can't represent without explicit input type param
const envSchema: z.ZodType<EnvSchemaOutput> = z.object({
  DATABASE_URL: z.preprocess(
    (val) => (typeof val === "string" && val.length === 0) ? undefined : val,
    z.string().url().optional(),
  ),
  NETWORK: z.enum(["mainnet", "testnet"]).optional(),
  NETWORKS: networksSchema.optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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

// Export for testing
export { envSchema };
