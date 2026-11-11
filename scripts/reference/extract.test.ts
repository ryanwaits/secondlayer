import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSystemIO } from "./extract";

const repo = mkdtempSync(join(tmpdir(), "reference-extract-"));
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function source(packageName: string, file: string, text: string) {
	const dir = join(repo, "packages", packageName, "src");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, file), text);
}

source("consumer", "index.ts", "export type Own = string;\n");
// Sorts before `documented`, so a name-ordered or filesystem-ordered scan
// reaches this private, undocumented declaration first.
source("a-private", "index.ts", 'type ColumnType = "uint" | "serial";\n');
source(
	"documented",
	"types.ts",
	'/** Supported column types */\nexport type ColumnType = "uint" | "text";\n',
);
source("alpha", "index.ts", "/** From alpha */\nexport type Shared = 1;\n");
source("beta", "index.ts", "/** From beta */\nexport type Shared = 2;\n");
source("shared", "index.ts", "/** From shared */\nexport type Common = 1;\n");
source("alpha", "common.ts", "/** From alpha */\nexport type Common = 2;\n");
source(
	"a-private",
	"alias.ts",
	"type Handle = Own;\nexport type Public = Own;\n",
);

describe("sibling type notes", () => {
	const io = fileSystemIO(repo, "packages/consumer");

	test("a sibling's private type never hides another sibling's exported doc", () => {
		expect(io.typeDoc?.("ColumnType")).toBe("Supported column types");
	});

	test("two siblings exporting one name resolve to the first by package name", () => {
		expect(io.typeDoc?.("Shared")).toBe("From alpha");
	});

	test("shared wins a name over every other sibling", () => {
		expect(io.typeDoc?.("Common")).toBe("From shared");
	});

	test("only an exported alias is borrowed from a sibling", () => {
		expect(io.aliasOf?.("Public")).toBe("Own");
		expect(io.aliasOf?.("Handle")).toBeUndefined();
	});
});
