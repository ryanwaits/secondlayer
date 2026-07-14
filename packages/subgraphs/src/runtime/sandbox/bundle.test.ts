import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bundleHandlerCode } from "./bundle.ts";

/** Stage the bundled ESM string to disk and import it — mirrors both this
 *  package's own `processor.ts` (writes `handler_code` to disk before
 *  `import()`ing it) and the eventual worker-side loader (`worker-entry.ts`),
 *  and avoids the `data:` URL length limit Bun's resolver enforces. */
async function importBundled(code: string): Promise<Record<string, unknown>> {
	const dir = mkdtempSync(join(tmpdir(), "f071-bundle-test-"));
	const file = join(dir, "handler.mjs");
	writeFileSync(file, code);
	return import(pathToFileURL(file).href);
}

describe("bundleHandlerCode — resolver lockdown", () => {
	it("bundles a real handler file (defineSubgraph stubbed) into an evaluable module", async () => {
		const source = `
			import { defineSubgraph } from "@secondlayer/subgraphs";
			export default defineSubgraph({
				name: "bundle-test",
				sources: { transfer: { type: "ft_transfer" } },
				schema: { transfers: { columns: { amount: { type: "uint" } } } },
				handlers: { transfer: (event, ctx) => { ctx.insert("transfers", { amount: event.amount }); } },
			});
		`;
		const bundled = await bundleHandlerCode(source);
		const mod = await importBundled(bundled);
		const def = mod.default as {
			name: string;
			handlers: Record<string, unknown>;
		};
		expect(def.name).toBe("bundle-test");
		expect(Object.keys(def.handlers)).toEqual(["transfer"]);
	});

	it("blocks node:fs — the module throws on evaluation rather than reading the filesystem", async () => {
		const bundled = await bundleHandlerCode(
			`import { readFileSync } from "node:fs"; export default function() { return readFileSync("/etc/passwd", "utf-8"); }`,
		);
		await expect(importBundled(bundled)).rejects.toThrow(/blocked/);
	});

	it("blocks node:child_process — the module throws on evaluation rather than spawning a process", async () => {
		const bundled = await bundleHandlerCode(
			`import { execSync } from "node:child_process"; export default function() { return execSync("echo hi"); }`,
		);
		await expect(importBundled(bundled)).rejects.toThrow(/blocked/);
	});

	it("blocks bun:sqlite (bun: protocol, not just node:)", async () => {
		const bundled = await bundleHandlerCode(
			`import { Database } from "bun:sqlite"; export default function() { return new Database(); }`,
		);
		await expect(importBundled(bundled)).rejects.toThrow(/blocked/);
	});

	it("blocks a bare npm specifier not on the allowlist", async () => {
		const bundled = await bundleHandlerCode(
			`import x from "undici"; export default x;`,
		);
		await expect(importBundled(bundled)).rejects.toThrow(/blocked/);
	});

	it("still permits the handler's own relative imports", async () => {
		const bundled = await bundleHandlerCode(`
			function helper(n: number) { return n * 2; }
			export default { double: helper(21) };
		`);
		const mod = await importBundled(bundled);
		expect((mod.default as { double: number }).double).toBe(42);
	});
});
