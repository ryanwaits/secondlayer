import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { parse as parseToml } from "smol-toml";

/**
 * Helpers for wiring a developer's Clarinet project to a local Secondlayer
 * indexer. We never depend on `@hirosystems/clarinet-sdk` here — the only
 * touch-point is reading `Clarinet.toml` to locate the project and editing
 * `settings/Devnet.toml` so the devnet's stacks-node forwards block events to
 * our indexer's event observer.
 */

/** The indexer event-observer endpoint a devnet node POSTs `/new_block` to. */
export const DEFAULT_INDEXER_OBSERVER = "host.docker.internal:3700";

/** Walk up from `startDir` until a directory containing `Clarinet.toml` is found. */
export function findClarinetProject(startDir: string): string | null {
	let dir = startDir;
	// Stop at the filesystem root — parsePath(root).root === root.
	const { root } = parsePath(dir);
	while (true) {
		if (existsSync(join(dir, "Clarinet.toml"))) return dir;
		if (dir === root) return null;
		dir = dirname(dir);
	}
}

export type EnsureObserverResult =
	| { status: "present" }
	| { status: "added" }
	| { status: "created" };

/**
 * Ensure `settings/Devnet.toml` registers `endpoint` under
 * `[devnet] stacks_node_events_observers`. Idempotent: a no-op if already
 * present. Edits are applied as targeted text insertions (not a smol-toml
 * round-trip) so the user's comments and formatting survive; smol-toml is used
 * only to read the current value for the presence check.
 */
export function ensureEventObserver(
	devnetTomlPath: string,
	endpoint: string = DEFAULT_INDEXER_OBSERVER,
): EnsureObserverResult {
	const exists = existsSync(devnetTomlPath);
	const original = exists ? readFileSync(devnetTomlPath, "utf8") : "";

	// Presence check via a real parse so we never duplicate an existing entry.
	if (original.trim()) {
		const parsed = parseToml(original) as {
			devnet?: { stacks_node_events_observers?: unknown };
		};
		const observers = parsed.devnet?.stacks_node_events_observers;
		if (Array.isArray(observers) && observers.includes(endpoint)) {
			return { status: "present" };
		}
	}

	const entry = JSON.stringify(endpoint); // TOML strings are JSON-compatible here

	// Case 1: an ACTIVE array already exists — insert at its head (works for
	// `[]`, `["x"]`, and multi-line arrays alike). The leading `[^#\n]*` keeps
	// us from matching a commented-out example line (Clarinet scaffolds one).
	const arrayStart = original.match(
		/^[^#\n]*stacks_node_events_observers\s*=\s*\[/m,
	);
	if (arrayStart) {
		const at = (arrayStart.index ?? 0) + arrayStart[0].length;
		const next = original.slice(at).trimStart().startsWith("]")
			? entry
			: `${entry}, `;
		const patched = original.slice(0, at) + next + original.slice(at);
		writeFileSync(devnetTomlPath, patched);
		return { status: "added" };
	}

	// Case 2: a [devnet] table exists but lacks the key — add it under the header.
	const header = original.match(/^\[devnet\]\s*$/m);
	if (header) {
		const at = (header.index ?? 0) + header[0].length;
		const patched = `${original.slice(0, at)}\nstacks_node_events_observers = [${entry}]${original.slice(at)}`;
		writeFileSync(devnetTomlPath, patched);
		return { status: "added" };
	}

	// Case 3: no [devnet] table (or no file) — append a fresh block.
	const prefix =
		original && !original.endsWith("\n") ? `${original}\n` : original;
	const block = `${prefix}${original.trim() ? "\n" : ""}[devnet]\nstacks_node_events_observers = [${entry}]\n`;
	writeFileSync(devnetTomlPath, block);
	return { status: exists ? "added" : "created" };
}
