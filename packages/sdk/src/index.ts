export { StreamsClient } from "./client.ts";
export type { StreamsClientOptions } from "./client.ts";
export { ApiError } from "./errors.ts";

/** Current SDK version string. */
export const SDK_VERSION = "0.2.0";

/** Health check response from the API. */
export interface HealthStatus {
  /** Whether the API is operational. */
  healthy: boolean;
  /** ISO timestamp of the check. */
  checkedAt: string;
}
