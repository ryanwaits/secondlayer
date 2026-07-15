import path from "node:path";
import { getErrorMessage } from "@secondlayer/shared";
import { toCamelCase } from "@secondlayer/stacks/clarity";
import chalk from "chalk";
import fg from "fast-glob";
import { PluginManager } from "../core/plugin-manager";
import { generateContractInterface } from "../generators/contract";
import { parseApiResponse, parseClarityFile } from "../parsers/clarity";
import type { SecondLayerConfig } from "../types/config";
import type { ContractConfig, ResolvedConfig } from "../types/plugin";
import { StacksApiClient } from "../utils/api";
import { findConfigFile, loadConfig } from "../utils/config";
import { parseContractId } from "../utils/contract-id";
import { checkBaseDependencies } from "../utils/dependencies";
import { inferNetwork } from "../utils/network";

/**
 * Generate command implementation
 */

export interface GenerateOptions {
	config?: string;
	out?: string;
	apiKey?: string;
	watch?: boolean;
}

/**
 * Check if a string looks like a deployed contract address (ADDRESS.contract-name)
 */
function isContractAddress(input: string): boolean {
	// Contract addresses are in format: SP/ST/SM/SN...ADDRESS.contract-name
	// SP = mainnet standard, ST = testnet standard
	// SM = mainnet multisig, SN = testnet multisig
	const contractIdPattern =
		/^(SP|ST|SM|SN)[A-Z0-9]{38,}\.[a-zA-Z][a-zA-Z0-9-]*$/;
	return contractIdPattern.test(input);
}

/**
 * Parse inputs and separate into local files and deployed contract addresses
 */
interface ParsedInputs {
	files: string[];
	contractIds: string[];
}

async function parseInputs(inputs: string[]): Promise<ParsedInputs> {
	const files: string[] = [];
	const contractIds: string[] = [];

	for (const input of inputs) {
		// Check if it's a deployed contract address
		if (isContractAddress(input)) {
			contractIds.push(input);
			continue;
		}

		// Check if it's a glob pattern
		if (input.includes("*") || input.includes("?")) {
			const matches = await fg(input, { cwd: process.cwd(), absolute: true });
			for (const file of matches) {
				if (file.endsWith(".clar")) {
					files.push(file);
				}
			}
			continue;
		}

		// Direct file path
		if (input.endsWith(".clar")) {
			const absolutePath = path.resolve(process.cwd(), input);
			files.push(absolutePath);
		}
	}

	return {
		files: [...new Set(files)],
		contractIds: [...new Set(contractIds)],
	};
}

/**
 * Convert filename to camelCase contract name
 */
function deriveContractName(filePath: string): string {
	const basename = path.basename(filePath, ".clar");
	// Convert kebab-case or snake_case to camelCase
	return basename
		.replace(/[-_](.)/g, (_, char) => char.toUpperCase())
		.replace(/^(.)/, (_, char) => char.toLowerCase())
		.replace(/^\d/, "_$&"); // Prefix with underscore if starts with digit
}

const DEFAULT_DEVNET_ADDRESS = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";

/**
 * Build config from direct inputs (local files and/or deployed contract addresses)
 */
async function buildConfigFromInputs(
	parsedInputs: ParsedInputs,
	outPath: string,
	apiKey: string | undefined,
	defaultAddress?: string,
): Promise<SecondLayerConfig> {
	const contracts = [];
	const deployer = defaultAddress || DEFAULT_DEVNET_ADDRESS;

	// Warn about placeholder address for local files
	if (parsedInputs.files.length > 0 && !defaultAddress) {
		console.warn(
			chalk.yellow(
				`⚠️  Using placeholder address (${deployer}) for local contracts.\n   Generated contract addresses won't match deployed addresses.\n   Set defaultAddress in config or use deployed contract addresses.`,
			),
		);
	}

	// Process local .clar files
	for (const file of parsedInputs.files) {
		const abi = await parseClarityFile(file);
		const name = deriveContractName(file);

		contracts.push({
			name,
			address: `${deployer}.${name}`,
			abi,
			_directFile: true,
		});
	}

	// Process deployed contract addresses (fetch from API)
	for (const contractId of parsedInputs.contractIds) {
		const { address, contractName } = parseContractId(contractId);
		const network = inferNetwork(address) ?? "mainnet";

		try {
			const apiClient = new StacksApiClient(network, apiKey);
			const contractInfo = await apiClient.getContractInfo(contractId);
			const abi = parseApiResponse(contractInfo);
			const name = toCamelCase(contractName);

			contracts.push({
				name,
				address: contractId,
				abi,
				_directFile: true,
			});
		} catch (error) {
			throw new Error(
				`Failed to fetch contract ${contractId}: ${getErrorMessage(error)}`,
			);
		}
	}

	return {
		out: outPath,
		contracts,
		plugins: [],
	};
}

export async function generate(files: string[], options: GenerateOptions) {
	if (!options.watch) {
		await runGenerate(files, options, { exitOnError: true });
		return;
	}

	await runGenerate(files, options, { exitOnError: false });
	await watchAndRegenerate(files, options);
}

async function runGenerate(
	files: string[],
	options: GenerateOptions,
	{ exitOnError }: { exitOnError: boolean },
) {
	try {
		let config: SecondLayerConfig;

		// Check if direct inputs were provided (files or contract addresses)
		if (files && files.length > 0) {
			// Require -o/--out when using direct inputs
			if (!options.out) {
				console.error(chalk.red("✗ Output path required"));
				console.error(
					chalk.red(
						"\nWhen using direct inputs, you must specify an output path with -o/--out",
					),
				);
				console.log(chalk.gray("\nExamples:"));
				console.log(
					chalk.gray(
						"  secondlayer generate ./contracts/*.clar -o ./src/generated.ts",
					),
				);
				console.log(
					chalk.gray(
						"  secondlayer generate SP2C2YFP12AJZB1M6DY7SF9A3PRHWKGYGVWQKW3.my-token -o ./src/generated.ts",
					),
				);
				process.exit(1);
			}

			// Parse inputs to separate files from contract addresses
			const parsedInputs = await parseInputs(files);
			const totalInputs =
				parsedInputs.files.length + parsedInputs.contractIds.length;

			if (totalInputs === 0) {
				console.error(chalk.red("✗ No valid inputs found"));
				console.error(
					chalk.red(
						"\nNo .clar files or contract addresses matched the provided inputs",
					),
				);
				process.exit(1);
			}

			// Get API key for direct RPC URLs from option or environment variable
			const apiKey = options.apiKey || process.env.STACKS_NODE_API_KEY;

			config = await buildConfigFromInputs(parsedInputs, options.out, apiKey);
		} else {
			// Use config file (existing behavior)
			config = await loadConfig(options.config);
		}

		// Get plugin manager from config loading
		const pluginManager = new PluginManager();

		// Register plugins from config
		if (config.plugins) {
			for (const plugin of config.plugins) {
				pluginManager.register(plugin);
			}
		}

		// Create resolved config with typed plugins
		const resolvedConfig: ResolvedConfig = {
			...config,
			plugins: pluginManager.getPlugins(),
		};

		// Execute configResolved hooks
		await pluginManager.executeHook("configResolved", resolvedConfig);

		// Convert existing contracts to ContractConfig format (if any)
		// Use the resolved config which includes contracts added by plugins
		const contractConfigs: ContractConfig[] = (config.contracts || []).map(
			(contract) => ({
				name: contract.name,
				address: contract.address,
				source: contract.source,
				// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
				abi: (contract as any).abi, // Include ABI if it exists (from plugins)
				// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
				_clarinetSource: (contract as any)._clarinetSource, // Include plugin flags
				// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
				_directFile: (contract as any)._directFile, // Include direct file flag
			}),
		);

		// Transform contracts through plugins (plugins can add more contracts)
		const processedContracts = await pluginManager.transformContracts(
			contractConfigs,
			resolvedConfig,
		);

		if (processedContracts.length === 0) {
			console.log(chalk.yellow("⚠ No contracts found to generate"));
			console.log("\nTo get started:");
			console.log("  • Add contracts to your config file, or");
			console.log("  • Use plugins like clarinet() for local contracts");
			return;
		}

		// Execute generation through plugin system
		const outputs = await pluginManager.executeGeneration(
			processedContracts,
			resolvedConfig,
		);

		// If no plugins generated the main contracts output, generate it using the existing generator
		if (!outputs.has("contracts") && processedContracts.length > 0) {
			const contractsCode = await generateContractInterface(processedContracts);
			outputs.set("contracts", {
				path: config.out,
				content: contractsCode,
				type: "contracts",
			});
		}

		// Transform outputs through plugins
		const transformedOutputs = await pluginManager.transformOutputs(outputs);

		// Write all outputs to disk
		await pluginManager.writeOutputs(transformedOutputs);

		// Check if @secondlayer/stacks is installed and warn if not
		await checkBaseDependencies(process.cwd());

		const contractCount = processedContracts.length;
		const contractWord = contractCount === 1 ? "contract" : "contracts";
		console.log(
			chalk.green(
				`✓ Generated \`${config.out}\` for ${contractCount} ${contractWord}`,
			),
		);
	} catch (error) {
		console.error(chalk.red("✗ Generation failed"));
		console.error(chalk.red(`\n${getErrorMessage(error)}`));
		if (process.env.DEBUG && error instanceof Error) {
			console.error(error.stack);
		}
		if (exitOnError) {
			process.exit(1);
		}
	}
}

// --- Watch mode ---

/** File names that should trigger regeneration when they change. */
function isWatchRelevant(filename: string): boolean {
	return (
		filename.endsWith(".clar") ||
		filename.endsWith(".toml") ||
		filename.startsWith("secondlayer.config")
	);
}

/**
 * Collect watch targets: parent directories of direct .clar inputs, the config
 * file, config-declared local sources, and the Clarinet project (manifest +
 * contracts dir) when present. Directories are watched (non-recursively for
 * plain parents, recursively for the Clarinet contracts dir) so atomic-save
 * editors don't drop the watcher.
 */
async function collectWatchTargets(
	files: string[],
	options: GenerateOptions,
): Promise<{ path: string; recursive: boolean }[]> {
	const { promises: fs } = await import("node:fs");
	const dirs = new Map<string, boolean>(); // path → recursive
	const addParentDir = (filePath: string) => {
		const dir = path.dirname(path.resolve(process.cwd(), filePath));
		if (!dirs.get(dir)) dirs.set(dir, false);
	};

	if (files && files.length > 0) {
		const parsedInputs = await parseInputs(files);
		for (const file of parsedInputs.files) {
			addParentDir(file);
		}
	} else {
		const configPath = options.config
			? path.resolve(process.cwd(), options.config)
			: await findConfigFile(process.cwd());
		if (configPath) addParentDir(configPath);

		try {
			const config = await loadConfig(options.config);
			for (const contract of config.contracts || []) {
				if (contract.source) addParentDir(contract.source);
			}
		} catch {
			// Config may be temporarily broken while the user edits it — the
			// config file's parent dir is already watched, so we recover on save.
		}

		// Clarinet project: watch the manifest dir and the contracts dir
		const manifestPath = path.resolve(process.cwd(), "Clarinet.toml");
		try {
			await fs.access(manifestPath);
			addParentDir(manifestPath);
			const contractsDir = path.resolve(process.cwd(), "contracts");
			try {
				const stat = await fs.stat(contractsDir);
				if (stat.isDirectory()) dirs.set(contractsDir, true);
			} catch {
				// no contracts dir
			}
		} catch {
			// no Clarinet project
		}
	}

	return [...dirs.entries()].map(([dir, recursive]) => ({
		path: dir,
		recursive,
	}));
}

async function watchAndRegenerate(files: string[], options: GenerateOptions) {
	const { watch } = await import("node:fs");
	const targets = await collectWatchTargets(files, options);

	if (targets.length === 0) {
		console.log(
			chalk.yellow("⚠ Nothing to watch — no local inputs were found"),
		);
		return;
	}

	console.log(
		chalk.cyan(
			`👀 Watching ${targets.length} ${targets.length === 1 ? "location" : "locations"} for changes — press Ctrl+C to stop`,
		),
	);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let running = false;
	let rerunRequested = false;

	const regenerate = async (changed?: string) => {
		if (running) {
			rerunRequested = true;
			return;
		}
		running = true;
		console.log(
			chalk.gray(
				`↻ ${changed ? `${changed} changed` : "Change detected"} — regenerating...`,
			),
		);
		await runGenerate(files, options, { exitOnError: false });
		running = false;
		if (rerunRequested) {
			rerunRequested = false;
			await regenerate();
		}
	};

	const onEvent = (filename: string | Buffer | null) => {
		const name = typeof filename === "string" ? filename : filename?.toString();
		if (name && !isWatchRelevant(path.basename(name))) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void regenerate(name ?? undefined), 150);
	};

	for (const target of targets) {
		try {
			watch(target.path, { recursive: target.recursive }, (_event, filename) =>
				onEvent(filename),
			);
		} catch {
			console.warn(chalk.yellow(`⚠ Could not watch ${target.path}`));
		}
	}

	// fs.watch keeps the event loop alive; block forever until Ctrl+C.
	await new Promise(() => {});
}
