import { expect, test } from "bun:test";

// The verifier runs in browsers (wallets, the docs page). Bundle it the way a
// web app would and hold it to a budget, so a Node-only import or a heavy
// dependency fails here instead of in someone's bundler.
const GZIP_BUDGET_BYTES = 60_000; // 39.7 KB at 2026-10-12

test("bundles for the browser with no Node built-ins, under the size budget", async () => {
	const result = await Bun.build({
		entrypoints: [`${import.meta.dir}/../src/index.ts`],
		target: "browser",
		minify: true,
	});
	expect(result.success).toBe(true);
	const code = await result.outputs[0].text();
	expect(code).not.toMatch(/(?:from\s*|require\(\s*|import\(\s*)["']node:/);
	expect(Bun.gzipSync(new TextEncoder().encode(code)).length).toBeLessThan(
		GZIP_BUDGET_BYTES,
	);
});
