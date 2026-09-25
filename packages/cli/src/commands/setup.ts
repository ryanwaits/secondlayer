import type { Command } from "commander";
import { bold, dim, note, printError, success, warn } from "../lib/output.ts";
import { assertInstanceUrl } from "../lib/resolve-auth.ts";
import {
	SetupCancelledError,
	promptSetupConfig,
} from "../lib/setup-prompts.ts";
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
 * this file's two ways of driving it (plain non-interactive, `@inquirer/prompts`)
 * can't quietly diverge on what "setup" does.
 *
 * Non-interactive is not a fallback — it is the point. `!isTTY` or `--yes`
 * skips prompting entirely and drives the exact same steps from flags,
 * printing plain progress lines and never blocking on input, so an autonomous
 * agent can drive this command exactly as well as a human at a terminal.
 *
 * A real terminal session with no `--yes` runs `@inquirer/prompts` instead:
 * it only fills in whatever `network`/`node-mode`/`against` flags didn't
 * already supply, then hands off to the same `resolveNonInteractiveConfig`
 * shape and `runSetup`.
 */

function renderProgress(event: SetupEvent): void {
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

/** Shared by the non-interactive and `@inquirer/prompts` paths: given an
 *  already-resolved config, run every step and render its progress. */
async function executeAndRender(config: ResolvedSetupConfig): Promise<void> {
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
		renderProgress(event);
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
	await executeAndRender(config);
}

/** `@inquirer/prompts` path: gathers whatever `network`/`node-mode`/`against`
 *  flags left out, then runs through the exact same non-interactive body. */
async function runPromptedInteractive(flags: SetupFlags): Promise<void> {
	let config: ResolvedSetupConfig;
	try {
		config = await promptSetupConfig(flags);
	} catch (err) {
		if (err instanceof SetupCancelledError) {
			note(err.message);
			process.exit(0);
		}
		printError(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
	await executeAndRender(config);
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
		.option("--dir <path>", "Target directory for compose + .env", ".")
		.option(
			"--against <manifest>",
			`Archive manifest to bootstrap from (default: ${DEFAULT_ARCHIVE_MANIFEST})`,
		)
		.option(
			"--skip-bootstrap",
			"Skip the archive restore; index only what your node sends from now on",
		)
		.option("--skip-verify", "Skip the post-bootstrap verify pass")
		.option(
			"--yes",
			"Non-interactive: skip the prompts, require flags, never ask",
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
  $ secondlayer setup --yes --network mainnet --node-mode external
  $ secondlayer setup --yes --network testnet --node-mode external --skip-bootstrap --skip-verify

Without a TTY (piped, CI, an agent), or with --yes, the prompts are skipped:
every decision with no safe default (--network, --node-mode) must come from a
flag or the command fails fast naming it. --against defaults to the official
archive (${DEFAULT_ARCHIVE_MANIFEST}) unless --skip-bootstrap is set.
`,
		)
		.action(async (opts: SetupFlags) => {
			assertInstanceUrl();
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
			await runPromptedInteractive(flags);
		});
}
