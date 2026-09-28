import { describe, expect, test } from "bun:test";
import { closeDbOrTimeout } from "./index.ts";

/**
 * 2026-09-28: a canonical export printed its summary and then sat idle for 20
 * minutes, stuck in `await closeDb()` — a driver holding a socket open past
 * shutdown finishing. `closeDbOrTimeout` exists so that hang can never again
 * stop a one-shot script from exiting once its actual work is done.
 */
describe("closeDbOrTimeout", () => {
	test("resolves as soon as the close finishes, well under the timeout", async () => {
		let closed = false;
		const start = Date.now();
		await closeDbOrTimeout(10_000, async () => {
			closed = true;
		});
		expect(closed).toBe(true);
		expect(Date.now() - start).toBeLessThan(1_000);
	});

	test("gives up once the timeout elapses, even if the close never resolves", async () => {
		const hungClose = () => new Promise<void>(() => {});
		const start = Date.now();
		await closeDbOrTimeout(50, hungClose);
		expect(Date.now() - start).toBeGreaterThanOrEqual(50);
		expect(Date.now() - start).toBeLessThan(2_000);
	});

	test("does not swallow — or wait on — a close that throws", async () => {
		// A rejection races the timeout like any other settlement; it must
		// surface immediately rather than being masked by the timeout winning.
		await expect(
			closeDbOrTimeout(10_000, async () => {
				throw new Error("pool destroy failed");
			}),
		).rejects.toThrow("pool destroy failed");
	});
});
