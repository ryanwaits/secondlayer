import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const pkg = await Bun.file(join(ROOT, "package.json")).json();
const server = await Bun.file(join(ROOT, "server.json")).json();

describe("server.json (MCP registry manifest)", () => {
	it("version matches the package version", () => {
		expect(server.version).toBe(pkg.version);
	});

	it("every npm package entry matches the package version", () => {
		expect(server.packages.length).toBeGreaterThan(0);
		for (const entry of server.packages) {
			expect(entry.identifier).toBe(pkg.name);
			expect(entry.version).toBe(pkg.version);
		}
	});

	it("name matches the package mcpName", () => {
		expect(server.name).toBe(pkg.mcpName);
	});
});
