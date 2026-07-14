import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifyContract,
	readManifestInfo,
} from "../src/plugins/clarinet/index";

const dir = mkdtempSync(join(tmpdir(), "clarinet-classify-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const DEPLOYER = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const ARKADIKO = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token";

function writeManifest(name: string, content: string): string {
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
}

describe("readManifestInfo", () => {
	test("parses [contracts.*] sections and inline requirements", async () => {
		const path = writeManifest(
			"inline.toml",
			`[project]
name = "demo"
requirements = [{ contract_id = "${ARKADIKO}" }]

[contracts.counter]
path = "contracts/counter.clar"

[contracts.pox-helper]
path = "contracts/pox-helper.clar"
`,
		);

		const info = await readManifestInfo(path);
		expect(info).not.toBeNull();
		expect([...(info?.projectContracts ?? [])]).toEqual([
			"counter",
			"pox-helper",
		]);
		expect(info?.requirementIds.has(ARKADIKO)).toBe(true);
	});

	test("parses [[project.requirements]] table-array form", async () => {
		const path = writeManifest(
			"table.toml",
			`[project]
name = "demo"

[[project.requirements]]
contract_id = '${ARKADIKO}'

[contracts.counter]
path = "contracts/counter.clar"
`,
		);

		const info = await readManifestInfo(path);
		expect(info?.requirementIds.has(ARKADIKO)).toBe(true);
	});

	test("returns null for unreadable manifest", async () => {
		expect(await readManifestInfo(join(dir, "missing.toml"))).toBeNull();
	});
});

describe("classifyContract", () => {
	const manifest = {
		projectContracts: new Set(["counter", "pox-helper"]),
		requirementIds: new Set([ARKADIKO]),
	};

	test("project contracts classify as project", () => {
		expect(classifyContract(`${DEPLOYER}.counter`, manifest)).toBe("project");
	});

	test("project contracts with boot-like names are still project", () => {
		// The old heuristic wrongly dropped names matching /^pox-\d+$/ etc.
		expect(classifyContract(`${DEPLOYER}.pox-helper`, manifest)).toBe(
			"project",
		);
	});

	test("declared requirements classify as requirement", () => {
		expect(classifyContract(ARKADIKO, manifest)).toBe("requirement");
	});

	test("everything else classifies as system when manifest is present", () => {
		expect(
			classifyContract("SP000000000000000000002Q6VF78.pox-4", manifest),
		).toBe("system");
		expect(
			classifyContract("SP000000000000000000002Q6VF78.bns", manifest),
		).toBe("system");
	});

	test("falls back to boot heuristics without a manifest", () => {
		expect(classifyContract("SP000000000000000000002Q6VF78.pox-4", null)).toBe(
			"system",
		);
		expect(classifyContract(`${DEPLOYER}.counter`, null)).toBe("project");
	});
});
