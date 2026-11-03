import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cloneName,
	discoverPackages,
	orderPackages,
	selectPackages,
	templateName,
	withDatabase,
} from "./test-packages";

function fakeRepo(packages: Record<string, object | string>): string {
	const root = mkdtempSync(join(tmpdir(), "test-packages-"));
	for (const [name, manifest] of Object.entries(packages)) {
		mkdirSync(join(root, "packages", name), { recursive: true });
		writeFileSync(
			join(root, "packages", name, "package.json"),
			typeof manifest === "string" ? manifest : JSON.stringify(manifest),
		);
	}
	mkdirSync(join(root, "packages", "no-manifest"), { recursive: true });
	return root;
}

describe("discoverPackages", () => {
	test("lists only packages that declare a test script", () => {
		const root = fakeRepo({
			cli: { scripts: { test: "bun test" } },
			api: { scripts: { test: "bun test", build: "x" } },
			docs: { scripts: { build: "x" } },
			bare: {},
			broken: "{ not json",
		});
		expect(discoverPackages(root)).toEqual(["api", "cli"]);
	});
});

describe("selectPackages", () => {
	test("defaults to every package", () => {
		expect(selectPackages(["api", "cli"], [])).toEqual(["api", "cli"]);
	});

	test("rejects a name with no test script", () => {
		expect(() => selectPackages(["api", "cli"], ["cli", "web"])).toThrow("web");
	});
});

describe("orderPackages", () => {
	test("starts the slow suites first, then the rest alphabetically", () => {
		expect(
			orderPackages([
				"workload",
				"api",
				"sdk",
				"subgraphs",
				"bitcoin",
				"cli",
				"indexer",
				"shared",
			]),
		).toEqual([
			"shared",
			"cli",
			"subgraphs",
			"api",
			"workload",
			"indexer",
			"bitcoin",
			"sdk",
		]);
	});

	test("keeps the fixed order when only some slow suites are selected", () => {
		expect(orderPackages(["mcp", "api", "cli"])).toEqual(["cli", "api", "mcp"]);
	});
});

describe("database names", () => {
	const url =
		"postgresql://postgres:pw@127.0.0.1:5432/secondlayer?sslmode=disable";

	test("clone name carries template, package and pid", () => {
		expect(cloneName("secondlayer", "subgraphs", 4242)).toBe(
			"secondlayer_t_subgraphs_4242",
		);
	});

	test("clone name refuses to exceed the 63-byte identifier limit", () => {
		expect(() => cloneName("a".repeat(60), "cli", 1)).toThrow("63-byte");
	});

	test("template name is the URL's database", () => {
		expect(templateName(url)).toBe("secondlayer");
		expect(() => templateName("postgresql://127.0.0.1:5432/")).toThrow();
	});

	test("withDatabase swaps only the database", () => {
		expect(withDatabase(url, "postgres")).toBe(
			"postgresql://postgres:pw@127.0.0.1:5432/postgres?sslmode=disable",
		);
	});
});
