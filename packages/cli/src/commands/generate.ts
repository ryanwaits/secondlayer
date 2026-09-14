import { promises as fs } from "node:fs";
import path from "node:path";
import { getErrorMessage } from "@secondlayer/shared";
import { toCamelCase } from "@secondlayer/stacks/clarity";
import fg from "fast-glob";
import { generateContractInterface } from "../generators/contract";
import { info, note, printError, success, warn } from "../lib/output.ts";
import { parseApiResponse, parseClarityFile } from "../parsers/clarity";
import type { ResolvedContract, SecondLayerConfig } from "../types/config";
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
	defaultAddress?: string,
): Promise<SecondLayerConfig> {
	const contracts = [];
	const deployer = defaultAddress || DEFAULT_DEVNET_ADDRESS;

	// Warn about placeholder address for local files
	if (parsedInputs.files.length > 0 && !defaultAddress) {
		warn(
			`Using placeholder address (${deployer}) for local contracts. Generated contract addresses won't match deployed addresses. Set defaultAddress in config or use deployed contract addresses.`,
		);
	}

	// Return types are not written down in Clarity source — they come out of the
	// type checker — so reading a .clar file can only report `any` for them.
	if (parsedInputs.files.length > 0) {
		warn(
			"Return types can't be read from Clarity source and will be `any`. Use `clarinet: true` or a deployed contract id for exact types.",
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
			const apiClient = new StacksApiClient(network);
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
	};
}

/** Convert a config contract with an ABI into a ResolvedContract */
function toResolvedContract(
	// biome-ignore lint/suspicious/noExplicitAny: config contracts carry optional plugin-era flags
	contract: any,
): ResolvedContract | null {
	if (!contract.abi) return null;

	const addressStr =
		typeof contract.address === "string" ? contract.address : "";
	let address = "unknown";
	let contractName = contract.name || "unknown";

	if (addressStr.includes(".")) {
		const parsed = parseContractId(addressStr);
		address = parsed.address;
		contractName = parsed.contractName || contractName;
	} else if (addressStr) {
		address = addressStr;
	}

	const isLocal = Boolean(contract._clarinetSource || contract._directFile);

	return {
		name: contract.name || contractName || "unknown",
		address,
		contractName,
		abi: contract.abi,
		source: isLocal ? "local" : "api",
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
				printError("Output path required", {
					hint: "When using direct inputs, pass -o/--output.",
				});
				note(
					"  secondlayer codegen contracts ./contracts/*.clar -o ./src/generated.ts",
				);
				note(
					"  secondlayer codegen contracts SP2C2YFP12AJZB1M6DY7SF9A3PRHWKGYGVWQKW3.my-token -o ./src/generated.ts",
				);
				if (exitOnError) process.exit(1);
				return;
			}

			// Parse inputs to separate files from contract addresses
			const parsedInputs = await parseInputs(files);
			const totalInputs =
				parsedInputs.files.length + parsedInputs.contractIds.length;

			if (totalInputs === 0) {
				printError("No valid inputs found", {
					hint: "No .clar files or contract addresses matched the provided inputs.",
				});
				if (exitOnError) process.exit(1);
				return;
			}

			config = await buildConfigFromInputs(parsedInputs, options.out);
		} else {
			// Use config file (existing behavior)
			config = await loadConfig(options.config);
		}

		const processedContracts: ResolvedContract[] = [];
		for (const contract of config.contracts || []) {
			const resolved = toResolvedContract(contract);
			if (resolved) processedContracts.push(resolved);
		}

		if (processedContracts.length === 0) {
			warn("No contracts found to generate");
			note("  Add contracts to your config file, or");
			note("  Set `clarinet: true` for local Clarinet projects");
			return;
		}

		const contractsCode = await generateContractInterface(processedContracts);
		const outPath = path.resolve(process.cwd(), config.out);
		await fs.mkdir(path.dirname(outPath), { recursive: true });
		await fs.writeFile(outPath, contractsCode, "utf-8");

		// Check if @secondlayer/stacks is installed and warn if not
		await checkBaseDependencies(process.cwd());

		const contractCount = processedContracts.length;
		const contractWord = contractCount === 1 ? "contract" : "contracts";
		success(`Generated \`${config.out}\` for ${contractCount} ${contractWord}`);
	} catch (error) {
		printError(`Generation failed: ${getErrorMessage(error)}`);
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
		warn("Nothing to watch — no local inputs were found");
		return;
	}

	info(
		`Watching ${targets.length} ${targets.length === 1 ? "location" : "locations"} for changes — press Ctrl+C to stop`,
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
		note(
			`${changed ? `${changed} changed` : "Change detected"} — regenerating...`,
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
			warn(`Could not watch ${target.path}`);
		}
	}

	// fs.watch keeps the event loop alive; block forever until Ctrl+C.
	await new Promise(() => {});
}
