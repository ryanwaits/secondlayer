/**
 * Git status inspection for subgraph source files.
 *
 * Used to warn/refuse deploying a subgraph definition whose source isn't
 * committed — the deployed definition would then exist only as a database
 * row, with no recoverable copy.
 */

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

export type SourceGitState =
	| { kind: "not-a-repo" }
	| { kind: "untracked" }
	| { kind: "modified" }
	| { kind: "clean" };

function runGit(args: string[], cwd: string): string | null {
	try {
		return execFileSync("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		return null;
	}
}

/**
 * Inspect the git state of a single source file. Runs git with `cwd` set to
 * the file's own directory (not `process.cwd()`) so this works when a
 * deploy is invoked with an absolute path from anywhere.
 *
 * Never throws: any unexpected git failure resolves to `not-a-repo`, the
 * permissive outcome — a broken git invocation must not block a deploy.
 */
export function inspectSourceGitState(absPath: string): SourceGitState {
	const cwd = dirname(absPath);

	const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
	if (insideWorkTree !== "true") {
		return { kind: "not-a-repo" };
	}

	const tracked = runGit(["ls-files", "--error-unmatch", absPath], cwd);
	if (tracked === null) {
		return { kind: "untracked" };
	}

	const status = runGit(["status", "--porcelain", "--", absPath], cwd);
	if (status === null) {
		// git is present and the repo is valid, but the status call itself
		// failed unexpectedly — fall back to the permissive outcome.
		return { kind: "not-a-repo" };
	}
	if (status.length > 0) {
		return { kind: "modified" };
	}

	return { kind: "clean" };
}
