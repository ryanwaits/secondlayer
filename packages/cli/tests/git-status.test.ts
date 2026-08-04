import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectSourceGitState } from "../src/lib/git-status.ts";

/**
 * `inspectSourceGitState` gates `sl subgraphs deploy` against undeployable
 * sources. Its whole job is reading real git state correctly, so these tests
 * drive real `git init` repos rather than mocking `child_process` — a mocked
 * git would only prove the mock was called, not that the logic is right.
 */

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "git-status-"));
	dirs.push(dir);
	execFileSync("git", ["init", "-q"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: dir,
	});
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
	return dir;
}

function commitFile(dir: string, name: string, content: string): string {
	const path = join(dir, name);
	writeFileSync(path, content);
	execFileSync("git", ["add", name], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "add file"], { cwd: dir });
	return path;
}

describe("inspectSourceGitState", () => {
	test("a file that was never added to the index is untracked", () => {
		const dir = tempRepo();
		const path = join(dir, "subgraph.ts");
		writeFileSync(path, "export default {};\n");
		expect(inspectSourceGitState(path)).toEqual({ kind: "untracked" });
	});

	test("a committed, unmodified file is clean", () => {
		const dir = tempRepo();
		const path = commitFile(dir, "subgraph.ts", "export default {};\n");
		expect(inspectSourceGitState(path)).toEqual({ kind: "clean" });
	});

	test("a committed file with uncommitted edits is modified", () => {
		const dir = tempRepo();
		const path = commitFile(dir, "subgraph.ts", "export default {};\n");
		writeFileSync(path, "export default { changed: true };\n");
		expect(inspectSourceGitState(path)).toEqual({ kind: "modified" });
	});

	test("a directory outside any git repo is not-a-repo", () => {
		const dir = mkdtempSync(join(tmpdir(), "git-status-non-repo-"));
		dirs.push(dir);
		const path = join(dir, "subgraph.ts");
		writeFileSync(path, "export default {};\n");
		expect(inspectSourceGitState(path)).toEqual({ kind: "not-a-repo" });
	});

	test("a broken .git directory resolves to not-a-repo instead of throwing", () => {
		const dir = tempRepo();
		const path = commitFile(dir, "subgraph.ts", "export default {};\n");
		// Corrupt the repo so every git invocation fails.
		rmSync(join(dir, ".git", "HEAD"), { force: true });
		expect(() => inspectSourceGitState(path)).not.toThrow();
		expect(inspectSourceGitState(path)).toEqual({ kind: "not-a-repo" });
	});
});
