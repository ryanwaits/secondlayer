/**
 * The `@inquirer/prompts` path for `secondlayer setup`'s interactive mode —
 * used whenever there's a TTY and `--yes` wasn't passed. This is the SECOND
 * consumer of `lib/setup-wizard.ts`'s step functions (alongside the plain
 * non-interactive runner) — it only ever gathers the same decisions (network,
 * node mode, bootstrap source), asking only for whatever a flag didn't
 * already supply, then hands off to the exact same
 * `resolveNonInteractiveConfig`-shaped config and `runSetup`. Nothing about
 * what setup DOES lives here.
 */

import { resolve as resolvePath } from "node:path";
import { confirm, input, select } from "@inquirer/prompts";
import { parseInstanceNetwork } from "./instance-init.ts";
import { DEFAULT_IMAGE_OWNER, DEFAULT_IMAGE_TAG } from "./oss-compose.ts";
import {
	DEFAULT_ARCHIVE_MANIFEST,
	type ResolvedSetupConfig,
	SETUP_NODE_MODES,
	type SetupFlags,
	guardrailPreview,
	parseSetupNodeMode,
} from "./setup-wizard.ts";

export class SetupCancelledError extends Error {
	constructor() {
		super("Setup cancelled — nothing was changed.");
		this.name = "SetupCancelledError";
	}
}

function safeParse<T>(
	value: string | undefined,
	parse: (v: string) => T,
): T | undefined {
	if (!value) return undefined;
	try {
		return parse(value);
	} catch {
		return undefined;
	}
}

const NODE_MODE_DESCRIPTIONS: Record<
	(typeof SETUP_NODE_MODES)[number],
	string
> = {
	external:
		"You run the Stacks node; paste an observer stanza into its Config.toml.",
	stacks:
		"You run the Stacks node yourself, no bundled bitcoind (same as external).",
	full: "Bundled Stacks node + bitcoind.",
};

/** Gathers whatever `network`/`node-mode`/`against` flags left out, via `@inquirer/prompts`. */
export async function promptSetupConfig(
	flags: SetupFlags,
): Promise<ResolvedSetupConfig> {
	const network =
		safeParse(flags.network, parseInstanceNetwork) ??
		(await select({
			message: "Network",
			choices: [
				{
					name: "mainnet",
					value: "mainnet" as const,
					description:
						"Production Stacks chain. Large: plan for hundreds of GB.",
				},
				{
					name: "testnet",
					value: "testnet" as const,
					description: "Stacks testnet. Small history.",
				},
				{
					name: "devnet",
					value: "devnet" as const,
					description: "Local Clarinet devnet.",
				},
			],
		}));

	const nodeMode =
		safeParse(flags.nodeMode, parseSetupNodeMode) ??
		(await select({
			message: "Node mode",
			choices: SETUP_NODE_MODES.map((mode) => {
				const floor = guardrailPreview(mode, network);
				return {
					name: mode,
					value: mode,
					description: `${NODE_MODE_DESCRIPTIONS[mode]} needs ≥ ${(floor.ramFloorMb / 1024).toFixed(0)}GB RAM, ≥ ${floor.diskFloorGb}GB disk.`,
				};
			}),
		}));

	let against = flags.against;
	let skipBootstrap = !!flags.skipBootstrap;
	if (!skipBootstrap && !against) {
		const choice = await select({
			message: "Bootstrap from",
			choices: [
				{
					name: "Hosted archive (recommended)",
					value: "hosted",
					description: DEFAULT_ARCHIVE_MANIFEST,
				},
				{
					name: "Custom manifest URL or path",
					value: "custom",
					description: "Enter your own",
				},
				{
					name: "Skip the archive",
					value: "skip",
					description: "Index only what your node sends from now on",
				},
			],
		});
		if (choice === "hosted") {
			against = DEFAULT_ARCHIVE_MANIFEST;
		} else if (choice === "skip") {
			skipBootstrap = true;
		} else {
			against = (
				await input({
					message: "Manifest URL or local path",
					default: DEFAULT_ARCHIVE_MANIFEST,
				})
			).trim();
		}
	}

	const config: ResolvedSetupConfig = {
		network,
		nodeMode,
		apiPort: flags.apiPort ?? "127.0.0.1:3800",
		indexerPort: "127.0.0.1:3700",
		postgresPort: "127.0.0.1:5432",
		dir: resolvePath(flags.dir ?? process.cwd()),
		against: skipBootstrap ? undefined : against,
		skipBootstrap,
		skipVerify: !!flags.skipVerify,
		yes: false,
		force: !!flags.force,
		owner: flags.owner ?? DEFAULT_IMAGE_OWNER,
		imageTag: flags.imageTag ?? DEFAULT_IMAGE_TAG,
	};

	console.error("");
	console.error(`  network      ${config.network}`);
	console.error(`  node mode    ${config.nodeMode}`);
	console.error(`  dir          ${config.dir}`);
	console.error(`  api port     ${config.apiPort}`);
	console.error(
		`  bootstrap    ${config.skipBootstrap ? "skip (from the node's tip)" : config.against}`,
	);
	console.error("");

	const proceed = await confirm({ message: "Start setup?", default: true });
	if (!proceed) throw new SetupCancelledError();

	return config;
}
