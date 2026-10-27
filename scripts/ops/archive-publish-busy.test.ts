import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LIB = resolve(
	import.meta.dir,
	"../../docker/scripts/lib/archive-publish-busy.sh",
);

function probe(activeState: string): string {
	const dir = mkdtempSync(join(tmpdir(), "busy-"));
	const fake = join(dir, "systemctl");
	writeFileSync(fake, `#!/bin/bash\necho "${activeState}"\n`);
	chmodSync(fake, 0o755);
	const result = Bun.spawnSync([
		"bash",
		"-c",
		`PATH=${dir}:$PATH; . ${LIB}; archive_publish_busy && echo busy || echo idle`,
	]);
	return result.stdout.toString().trim();
}

describe("archive_publish_busy", () => {
	it("a running oneshot unit reports activating and counts as busy", () => {
		expect(probe("activating")).toBe("busy");
	});
	for (const state of ["active", "reloading", "deactivating"]) {
		it(`${state} is busy`, () => {
			expect(probe(state)).toBe("busy");
		});
	}
	for (const state of ["inactive", "failed", ""]) {
		it(`${state || "empty output"} is idle`, () => {
			expect(probe(state)).toBe("idle");
		});
	}
});
