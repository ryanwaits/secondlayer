/**
 * Clarinet Plugin for @secondlayer/cli
 * Generates type-safe contract interfaces from local Clarity contracts using Clarinet SDK
 */

import { initSimnet } from "@hirosystems/clarinet-sdk";
import { toCamelCase } from "@secondlayer/stacks/clarity";
import { generateContractInterface } from "../../generators/contract";
import type {
	GenerateContext,
	PluginFactory,
	UserConfig,
} from "../../types/plugin";
import { normalizeAbi } from "../../utils/abi-compat";
import { DEFAULT_SENDER_ADDRESS } from "../../utils/constants";
import { parseContractId } from "../../utils/contract-id";
import { matchesContractFilters } from "../shared";

export interface ClarinetPluginOptions {
	/** Path to Clarinet.toml file */
	path?: string;

	/** Include only specific contracts */
	include?: string[];

	/** Exclude specific contracts */
	exclude?: string[];

	/**
	 * Also generate interfaces for dependency contracts declared under
	 * `[project.requirements]` in Clarinet.toml (default: true).
	 */
	includeRequirements?: boolean;

	/** Enable debug output */
	debug?: boolean;
}

/**
 * Sanitize contract name to be a valid JavaScript identifier using camelCase
 */
function sanitizeContractName(name: string): string {
	return toCamelCase(name);
}

/** @internal exported for tests */
export interface ManifestInfo {
	/** Names from `[contracts.NAME]` sections */
	projectContracts: Set<string>;
	/** Fully-qualified ids from `[project.requirements]` entries */
	requirementIds: Set<string>;
}

/**
 * Read project contracts and requirements from Clarinet.toml. Returns null if
 * the manifest can't be read (callers fall back to pattern heuristics).
 */
export async function readManifestInfo(
	manifestPath: string,
): Promise<ManifestInfo | null> {
	try {
		const { promises: fs } = await import("node:fs");
		const tomlContent = await fs.readFile(manifestPath, "utf-8");

		// Simple TOML parsing: [contracts.NAME] sections
		const projectContracts = new Set<string>();
		const contractSectionRegex = /^\[contracts\.([^\]]+)\]/gm;
		let match: RegExpExecArray | null = contractSectionRegex.exec(tomlContent);
		while (match !== null) {
			projectContracts.add(match[1]);
			match = contractSectionRegex.exec(tomlContent);
		}

		// Requirements: `contract_id = "SP....name"` entries — covers both the
		// inline `requirements = [{ contract_id = "..." }]` and the
		// `[[project.requirements]]` table-array forms.
		const requirementIds = new Set<string>();
		const requirementRegex = /contract_id\s*=\s*["']([^"']+)["']/g;
		match = requirementRegex.exec(tomlContent);
		while (match !== null) {
			requirementIds.add(match[1]);
			match = requirementRegex.exec(tomlContent);
		}

		return { projectContracts, requirementIds };
	} catch {
		return null;
	}
}

/** @internal exported for tests */
export type ContractKind = "project" | "requirement" | "system";

/**
 * Classify a simnet contract. With a readable manifest the classification is
 * deterministic: `[contracts.*]` → project, `[project.requirements]` →
 * requirement, everything else (boot contracts) → system. Without a manifest,
 * fall back to boot-contract heuristics.
 */
export function classifyContract(
	contractId: string,
	manifest: ManifestInfo | null,
): ContractKind {
	const { address, contractName } = parseContractId(contractId);

	if (manifest) {
		if (manifest.projectContracts.has(contractName)) return "project";
		if (manifest.requirementIds.has(contractId)) return "requirement";
		return "system";
	}

	// Fallback heuristics: boot contracts have well-known names/addresses
	const systemContractPatterns = [
		/^pox-\d+$/, // pox-2, pox-3, etc.
		/^bns$/, // Blockchain Name System
		/^costs-\d+$/, // costs-2, costs-3, etc.
		/^lockup$/, // lockup contract
	];
	if (systemContractPatterns.some((pattern) => pattern.test(contractName))) {
		return "system";
	}

	const systemAddresses = [
		DEFAULT_SENDER_ADDRESS, // Boot contracts address
		"ST000000000000000000002AMW42H", // Boot contracts address (testnet)
	];
	if (systemAddresses.includes(address)) {
		return "system";
	}

	return "project";
}

/**
 * Clarinet plugin factory
 */
export const clarinet: PluginFactory<ClarinetPluginOptions> = (
	options = {},
) => {
	const manifestPath = options.path || "./Clarinet.toml";
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
	let simnet: any;

	return {
		name: "@secondlayer/cli/plugin-clarinet",
		version: "1.0.0",

		async transformConfig(config: UserConfig): Promise<UserConfig> {
			try {
				// Initialize simnet to extract contract ABIs
				simnet = await initSimnet(manifestPath);

				// Get contract interfaces from Clarinet
				const contractInterfaces = simnet.getContractsInterfaces();
				const contracts = [];
				const manifest = await readManifestInfo(manifestPath);
				const includeRequirements = options.includeRequirements ?? true;

				for (const [contractId, abi] of contractInterfaces) {
					const { contractName } = parseContractId(contractId);

					const kind = classifyContract(contractId, manifest);

					// Skip system/boot contracts, and requirements when opted out
					if (
						kind === "system" ||
						(kind === "requirement" && !includeRequirements)
					) {
						if (options.debug) {
							console.log(`🚫 Skipping ${kind} contract: ${contractId}`);
						}
						continue;
					}

					// Apply user filters
					if (!matchesContractFilters(contractName, options)) {
						continue;
					}

					// Sanitize the contract name for JavaScript export
					const sanitizedName = sanitizeContractName(contractName);

					// Don't set source field to avoid conflict with file resolution
					// Instead, we'll track this in metadata during processing
					contracts.push({
						name: sanitizedName,
						address: contractId,
						abi: normalizeAbi(abi),
						// Remove source field - this was causing the path resolution issue
						_clarinetSource: true, // Internal flag for our plugin
					});
				}

				if (options.debug) {
					console.log(
						`🔍 Clarinet plugin found ${contracts.length} user-defined contracts`,
					);
				}

				return {
					...config,
					contracts: [...(config.contracts || []), ...contracts],
				};
			} catch (error) {
				const err = error as Error;
				if (await hasClarinetProject(manifestPath)) {
					// Manifest exists but loading failed — always surface it
					console.warn(
						`⚠️  Clarinet plugin: found ${manifestPath} but failed to load contracts: ${err.message}`,
					);
				} else if (options.debug) {
					console.warn(
						`⚠️  Clarinet plugin: no manifest at ${manifestPath}, skipping`,
					);
				}
				return config;
			}
		},

		async generate(context: GenerateContext): Promise<void> {
			// Filter contracts that came from Clarinet
			const clarinetContracts = context.contracts.filter(
				(contract) => contract.metadata?.source === "clarinet",
			);

			if (clarinetContracts.length === 0) {
				return;
			}

			if (options.debug) {
				context.logger.debug(
					`Generating interfaces for ${clarinetContracts.length} Clarinet contracts`,
				);
			}

			// Generate the main contracts file using existing generator
			const contractsCode = await generateContractInterface(clarinetContracts);

			context.addOutput("contracts", {
				path: context.config.out,
				content: contractsCode,
				type: "contracts",
			});

			// Don't log success here - let the main command handle it
		},
	};
};

/**
 * Utility function to check if a Clarinet project exists
 */
export async function hasClarinetProject(
	path = "./Clarinet.toml",
): Promise<boolean> {
	try {
		const { promises: fs } = await import("node:fs");
		await fs.access(path);
		return true;
	} catch {
		return false;
	}
}
