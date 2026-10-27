import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LIB = resolve(
	import.meta.dir,
	"../../docker/scripts/lib/indexer-unchanged.sh",
);

const DOCKER = `#!/bin/bash
[ -n "$NO_CONTAINER" ] && exit 1
case "$*" in
  *State.Running*) echo "$RUNNING" ;;
  *Config.Image*) echo "$RUNNING_IMAGE" ;;
  *"inspect -f {{.Image}}"*) echo "sha256:running" ;;
  *"image inspect"*sha256:running) echo "$RUNNING_LAYERS" ;;
  *"image inspect"*)
    [ -n "$NEW_LAYERS" ] || exit 1
    echo "$NEW_LAYERS" ;;
  *config-hash*) echo "$LABEL" ;;
  *) exit 1 ;;
esac
`;

const COMPOSE = `#!/bin/bash
case "$*" in
  "config --images indexer")
    echo "postgres:17-alpine"
    echo "ghcr.io/o/secondlayer-api:bbb"
    [ -n "$NEW_IMAGE" ] && echo "$NEW_IMAGE" ;;
  "config --hash indexer")
    if [ "$DEPLOY_IMAGE_TAG" = "$RUNNING_TAG" ]; then echo "indexer $PINNED_HASH"; else echo "indexer other"; fi ;;
  *) exit 1 ;;
esac
`;

const base = {
	RUNNING: "true",
	RUNNING_TAG: "aaa",
	RUNNING_IMAGE: "ghcr.io/o/secondlayer-indexer:aaa",
	NEW_IMAGE: "ghcr.io/o/secondlayer-indexer:bbb",
	RUNNING_LAYERS: '["l1","l2"]',
	NEW_LAYERS: '["l1","l2"]',
	LABEL: "hash1",
	PINNED_HASH: "hash1",
};

function probe(overrides: Record<string, string> = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "indexer-unchanged-"));
	for (const [name, body] of [
		["docker", DOCKER],
		["compose", COMPOSE],
	]) {
		const path = join(dir, name as string);
		writeFileSync(path, body as string);
		chmodSync(path, 0o755);
	}
	const result = Bun.spawnSync(
		[
			"bash",
			"-c",
			`PATH=${dir}:$PATH; COMPOSE=compose; . ${LIB}; indexer_unchanged && echo unchanged || echo changed`,
		],
		{ env: { ...process.env, ...base, ...overrides } },
	);
	return result.stdout.toString().trim();
}

describe("indexer_unchanged", () => {
	it("same layers and a config hash that only differs by tag is unchanged", () => {
		expect(probe()).toBe("unchanged");
	});
	it("different image layers is changed", () => {
		expect(probe({ NEW_LAYERS: '["l1","l3"]' })).toBe("changed");
	});
	it("a config hash that differs from the container label is changed", () => {
		expect(probe({ PINNED_HASH: "hash2" })).toBe("changed");
	});
	it("a stopped container is changed", () => {
		expect(probe({ RUNNING: "false" })).toBe("changed");
	});
	it("a new image that is not pulled locally is changed", () => {
		expect(probe({ NEW_LAYERS: "" })).toBe("changed");
	});
	it("a new image reference equal to the running one is changed", () => {
		expect(probe({ NEW_IMAGE: base.RUNNING_IMAGE })).toBe("changed");
	});
	it("dependency images listed before the indexer's do not decide the answer", () => {
		expect(probe({ NEW_IMAGE: "" })).toBe("changed");
	});
	it("a missing container is changed", () => {
		expect(probe({ NO_CONTAINER: "1" })).toBe("changed");
	});
});
