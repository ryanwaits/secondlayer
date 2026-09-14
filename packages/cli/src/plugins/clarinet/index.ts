/**
 * Clarinet contract source for @secondlayer/cli
 * Loads simnet ABIs from a local Clarinet project.
 */

import { toCamelCase } from "@secondlayer/stacks/clarity";
import { normalizeAbi } from "@secondlayer/stacks/clarity";
import type { AbiContract } from "@secondlayer/stacks/clarity";
import { initSimnet } from "@stacks/clarinet-sdk";
import { DEFAULT_SENDER_ADDRESS } from "../../utils/constants";
import { parseContractId } from "../../utils/contract-id";

export interface ClarinetOptions {
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

/** Contract loaded from Clarinet simnet, ready to merge into config.contracts */
export interface ClarinetLoadedContract {
	name: string;
	address: string;
	abi: AbiContract;
	_clarinetSource: true;
}

/**
 * Sanitize contract name to be a valid JavaScript identifier using camelCase
 */
function sanitizeContractName(name: string): string {
	return toCamelCase(name);
}

function matchesContractFilters(
	name: string,
	options: Pick<ClarinetOptions, "include" | "exclude">,
): boolean {
	if (options.include && !options.include.includes(name)) {
		return false;
	}
	if (options.exclude?.includes(name)) {
		return false;
	}
	return true;
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
		/^signer-manager$/, // SIP-045 (epoch 4.0) boot contract
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
 * Load contract ABIs from a Clarinet project via simnet.
 * Skips silently when no manifest exists (deployed-id-only configs).
 */
export async function loadClarinetContracts(
	options: ClarinetOptions = {},
): Promise<ClarinetLoadedContract[]> {
	const manifestPath = options.path || "./Clarinet.toml";

	try {
		const simnet = await initSimnet(manifestPath);
		const contractInterfaces = simnet.getContractsInterfaces();
		const contracts: ClarinetLoadedContract[] = [];
		const manifest = await readManifestInfo(manifestPath);
		const includeRequirements = options.includeRequirements ?? true;

		for (const [contractId, abi] of contractInterfaces) {
			const { contractName } = parseContractId(contractId);
			const kind = classifyContract(contractId, manifest);

			if (
				kind === "system" ||
				(kind === "requirement" && !includeRequirements)
			) {
				if (options.debug) {
					console.log(`🚫 Skipping ${kind} contract: ${contractId}`);
				}
				continue;
			}

			if (!matchesContractFilters(contractName, options)) {
				continue;
			}

			contracts.push({
				name: sanitizeContractName(contractName),
				address: contractId,
				abi: normalizeAbi(abi),
				_clarinetSource: true,
			});
		}

		if (options.debug) {
			console.log(
				`🔍 Clarinet found ${contracts.length} user-defined contracts`,
			);
		}

		return contracts;
	} catch (error) {
		const err = error as Error;
		if (await hasClarinetProject(manifestPath)) {
			console.warn(
				`⚠️  Clarinet: found ${manifestPath} but failed to load contracts: ${err.message}`,
			);
		} else if (options.debug) {
			console.warn(`⚠️  Clarinet: no manifest at ${manifestPath}, skipping`);
		}
		return [];
	}
}

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
