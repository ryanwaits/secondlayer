/**
 * Shared code formatting utilities using Biome
 */

import { Biome, Distribution } from "@biomejs/js-api";

let biome: Biome | null = null;

/**
 * Lazily initialize Biome singleton
 */
async function getBiome(): Promise<Biome> {
	if (!biome) {
		biome = await Biome.create({
			distribution: Distribution.NODE,
		});

		biome.applyConfiguration({
			formatter: {
				enabled: true,
				indentStyle: "tab",
				lineWidth: 80,
			},
			javascript: {
				formatter: {
					semicolons: "always",
					quoteStyle: "single",
				},
			},
			organizeImports: {
				enabled: true,
			},
			linter: {
				enabled: true,
			},
			assists: {
				enabled: true,
			},
		});

		// Intentionally NOT calling registerProjectFolder(): doing so makes Biome
		// load the on-disk biome.json (which has no quoteStyle, so it defaults to
		// double quotes) and override the single-quote style pinned above. Whether
		// that override won was timing-dependent across the shared singleton,
		// making generated output nondeterministic between test runs. Relying only
		// on applyConfiguration keeps codegen output stable regardless of cwd.
	}

	return biome;
}

/**
 * Format TypeScript code using Biome
 */
export async function formatCode(code: string): Promise<string> {
	const b = await getBiome();

	// Use lintContent with SafeFixes to organize imports
	const linted = b.lintContent(code, {
		filePath: "generated.ts",
		fixFileMode: "SafeFixes",
	});

	// Then format
	const formatted = b.formatContent(linted.content, {
		filePath: "generated.ts",
	});

	return formatted.content;
}
