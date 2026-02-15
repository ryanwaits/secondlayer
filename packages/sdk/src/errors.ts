/**
 * Error thrown by {@link SecondLayer} when an API request fails.
 * Includes the HTTP status code for programmatic error handling.
 *
 * @example
 * ```ts
 * try {
 *   await client.streams.get("abc123");
 * } catch (err) {
 *   if (err instanceof ApiError && err.status === 404) {
 *     console.log("Stream not found");
 *   }
 * }
 * ```
 */
export class ApiError extends Error {
  constructor(
    /** HTTP status code (0 for network errors). */
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}
