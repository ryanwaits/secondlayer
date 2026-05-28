import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
	DEFAULT_INDEXER_OBSERVER,
	ensureEventObserver,
	findClarinetProject,
} from "../src/lib/devnet-config.ts";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "sl-devnet-"));
}

function observers(path: string): string[] {
	const parsed = parseToml(readFileSync(path, "utf8")) as {
		devnet?: { stacks_node_events_observers?: string[] };
	};
	return parsed.devnet?.stacks_node_events_observers ?? [];
}

describe("ensureEventObserver", () => {
	test("creates the file + [devnet] block when missing", () => {
		const path = join(tmp(), "Devnet.toml");
		expect(ensureEventObserver(path)).toEqual({ status: "created" });
		expect(observers(path)).toContain(DEFAULT_INDEXER_OBSERVER);
	});

	test("is idempotent — patching twice is a no-op", () => {
		const path = join(tmp(), "Devnet.toml");
		ensureEventObserver(path);
		expect(ensureEventObserver(path)).toEqual({ status: "present" });
		expect(observers(path)).toEqual([DEFAULT_INDEXER_OBSERVER]);
	});

	test("adds the key to an existing [devnet] table, preserving comments", () => {
		const path = join(tmp(), "Devnet.toml");
		writeFileSync(
			path,
			"# my devnet\n[devnet]\nbitcoin_controller_block_time = 1000\n",
		);
		expect(ensureEventObserver(path)).toEqual({ status: "added" });
		const text = readFileSync(path, "utf8");
		expect(text).toContain("# my devnet");
		expect(text).toContain("bitcoin_controller_block_time = 1000");
		expect(observers(path)).toContain(DEFAULT_INDEXER_OBSERVER);
	});

	test("appends to an existing observers array without dropping entries", () => {
		const path = join(tmp(), "Devnet.toml");
		writeFileSync(
			path,
			'[devnet]\nstacks_node_events_observers = ["other:9000"]\n',
		);
		expect(ensureEventObserver(path)).toEqual({ status: "added" });
		const obs = observers(path);
		expect(obs).toHaveLength(2);
		expect(obs).toContain("other:9000");
		expect(obs).toContain(DEFAULT_INDEXER_OBSERVER);
	});

	test("ignores a commented-out example and adds an active entry", () => {
		const path = join(tmp(), "Devnet.toml");
		// Clarinet scaffolds Devnet.toml with this exact commented example.
		writeFileSync(
			path,
			'[devnet]\ndisable_stacks_api = false\n# stacks_node_events_observers = ["host.docker.internal:3700", "host.docker.internal:8002"]\n',
		);
		expect(ensureEventObserver(path)).toEqual({ status: "added" });
		const text = readFileSync(path, "utf8");
		// The comment survives untouched…
		expect(text).toContain(
			'# stacks_node_events_observers = ["host.docker.internal:3700", "host.docker.internal:8002"]',
		);
		// …and an *active* observer now parses out.
		expect(observers(path)).toEqual([DEFAULT_INDEXER_OBSERVER]);
	});

	test("is a no-op when the endpoint is already in the array", () => {
		const path = join(tmp(), "Devnet.toml");
		writeFileSync(
			path,
			`[devnet]\nstacks_node_events_observers = ["${DEFAULT_INDEXER_OBSERVER}"]\n`,
		);
		expect(ensureEventObserver(path)).toEqual({ status: "present" });
	});
});

describe("findClarinetProject", () => {
	test("finds Clarinet.toml in a parent directory", () => {
		const root = tmp();
		writeFileSync(join(root, "Clarinet.toml"), "[project]\nname = 'x'\n");
		const nested = join(root, "contracts", "deep");
		mkdirSync(nested, { recursive: true });
		expect(findClarinetProject(nested)).toBe(root);
	});

	test("returns null when no Clarinet.toml exists", () => {
		expect(findClarinetProject(tmp())).toBeNull();
	});
});
