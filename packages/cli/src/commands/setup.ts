import type { Command } from "commander";
import { bold, dim, note, printError, success, warn } from "../lib/output.ts";
import {
	DEFAULT_ARCHIVE_MANIFEST,
	MissingSetupFlagError,
	type ResolvedSetupConfig,
	type SetupEvent,
	type SetupFlags,
	resolveNonInteractiveConfig,
	runSetup,
} from "../lib/setup-wizard.ts";

/**
 * `secondlayer setup` — replaces the 5-command, 1-manual-copy-paste onboarding
 * path (`init` → hand-copy secrets into `docker/oss/.env` → `docker compose up`
 * → `observer` → hand-paste into the node's Config.toml → `bootstrap` →
 * `verify`) with one command.
 *
 * This file owns flag parsing and rendering ONLY. Every actual step —
 * generating secrets, writing compose/.env, bringing docker up, shelling out
 * to bootstrap/verify — lives in `lib/setup-wizard.ts` as plain functions, so
 * this (non-interactive) path and the TUI (`setup-tui.tsx`) can never quietly
 * diverge on what "setup" does.
 *
 * Non-interactive is not a fallback — it is the point. `!isTTY` or `--yes`
 * skips the TUI entirely and drives the exact same steps from flags, printing
 * plain progress lines and never blocking on input, so an autonomous agent can
 * drive this command exactly as well as a human at a terminal.
 */

function renderNonInteractive(event: SetupEvent): void {
	switch (event.type) {
		case "step-start":
			note(`→ ${event.step}`);
			return;
		case "step-log":
			note(`  ${event.line}`);
			return;
		case "step-done":
			success(event.step + (event.detail ? `: ${event.detail}` : ""));
			return;
		case "step-skip":
			note(`  skipped ${event.step} (${event.reason})`);
			return;
		case "step-error":
			printError(`${event.step} failed: ${event.message}`);
			return;
	}
}

async function runNonInteractive(flags: SetupFlags): Promise<void> {
	let config: ResolvedSetupConfig;
	try {
		config = resolveNonInteractiveConfig(flags);
	} catch (err) {
		if (err instanceof MissingSetupFlagError) {
			printError(err.message, { hint: `Pass ${err.flag} and re-run.` });
		} else {
			printError(err instanceof Error ? err.message : String(err));
		}
		process.exit(1);
	}

	console.error(bold("Secondlayer setup"));
	console.error(
		dim(
			`  network=${config.network} node-mode=${config.nodeMode} dir=${config.dir}`,
		),
	);
	console.error("");

	let failed = false;
	const result = await runSetup(config, (event) => {
		if (event.type === "step-error") failed = true;
		renderNonInteractive(event);
	});

	if (!result.ok) {
		process.exit(1);
	}
	if (failed) {
		warn("Setup finished with at least one step reporting an error above.");
	}
	console.error("");
	if (result.summary) console.log(result.summary);
	process.exit(failed ? 1 : 0);
}

export function registerSetupCommand(program: Command): void {
	program
		.command("setup")
		.description(
			"Guided self-host onboarding: secrets, config, docker, bootstrap, verify — one command",
		)
		// --network is deliberately NOT redeclared here: cli.ts already registers
		// a global `--network <network>` on `program`, and commander resolves a
		// flag by the first command in the chain that declares it — a second,
		// command-local `--network` here would just shadow the global one's
		// parsed value with `undefined` instead of receiving it. The global
		// preAction hook writes it to STACKS_NETWORK before this action runs.
		.option("--node-mode <mode>", "external, stacks, or full (required)")
		.option("--api-port <spec>", "API publish spec", "127.0.0.1:3800")
		.option(
			"--dir <path>",
			"Target directory for compose + .env",
			process.cwd(),
		)
		.option(
			"--against <manifest>",
			`Archive manifest to bootstrap from (suggested default: ${DEFAULT_ARCHIVE_MANIFEST})`,
		)
		.option(
			"--skip-bootstrap",
			"Sync from genesis instead of restoring an archive",
		)
		.option("--skip-verify", "Skip the post-bootstrap verify pass")
		.option(
			"--yes",
			"Non-interactive: skip the TUI, require flags, never prompt",
		)
		.option(
			"--force",
			"Regenerate secrets even if a .env already exists in --dir",
		)
		.option("--owner <owner>", "ghcr image owner (namespace) to pull from")
		.option("--image-tag <tag>", "Published image tag to run")
		.addHelpText(
			"after",
			`
--network <mainnet|testnet|devnet> is the top-level global flag (see
\`secondlayer --help\`) — required here too, just parsed one level up.

Examples:
  $ secondlayer setup
  $ secondlayer setup --yes --network mainnet --node-mode external --against ${DEFAULT_ARCHIVE_MANIFEST}
  $ secondlayer setup --yes --network testnet --node-mode external --skip-bootstrap --skip-verify

Without a TTY (piped, CI, an agent), or with --yes, the TUI is skipped: every
decision with no safe default (--network, --node-mode, and --against unless
--skip-bootstrap) must come from a flag or the command fails fast naming it.
`,
		)
		.action(async (opts: SetupFlags) => {
			// --network arrives via the global flag (see the option comment
			// above), landing on STACKS_NETWORK through cli.ts's preAction hook
			// rather than on this command's own `opts`.
			const flags: SetupFlags = {
				...opts,
				network: opts.network ?? process.env.STACKS_NETWORK,
			};
			const interactive = process.stdout.isTTY && !flags.yes;
			if (!interactive) {
				await runNonInteractive(flags);
				return;
			}
			const { runSetupTui } = await import("../lib/setup-tui.tsx");
			await runSetupTui(flags);
		});
}
