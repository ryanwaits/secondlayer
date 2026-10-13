import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The SDK reference attaches `examples/<surface>/<method id>.ts` to its method
 * (see scripts/reference). They are real programs, so they must compile against
 * the SDK as it is today, and each must be attached in the generated reference.
 */
const PACKAGE = join(import.meta.dir, "..");
const EXAMPLES = join(PACKAGE, "examples");
const REFERENCE = join(PACKAGE, "../../apps/web/src/generated/reference/sdk");

type Surface = {
	methods: { id: string; examples: { file: string }[] }[];
};

function exampleFiles(): { surface: string; id: string; file: string }[] {
	return readdirSync(EXAMPLES, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.flatMap((dir) =>
			readdirSync(join(EXAMPLES, dir.name))
				.filter((f) => f.endsWith(".ts"))
				.map((f) => ({
					surface: dir.name,
					id: f.slice(0, -".ts".length),
					file: `packages/sdk/examples/${dir.name}/${f}`,
				})),
		);
}

describe("SDK examples", () => {
	test("type-check against the SDK source", () => {
		const result = Bun.spawnSync(
			["bunx", "tsc", "--noEmit", "-p", "tsconfig.examples.json"],
			{ cwd: PACKAGE, stdout: "pipe", stderr: "pipe" },
		);
		expect(result.stdout.toString()).toBe("");
		expect(result.exitCode).toBe(0);
	}, 120_000);

	test("each example is attached to its method in the generated reference", () => {
		const unattached: string[] = [];
		for (const example of exampleFiles()) {
			const surfaceFile = join(REFERENCE, `${example.surface}.json`);
			const surface = existsSync(surfaceFile)
				? (JSON.parse(readFileSync(surfaceFile, "utf8")) as Surface)
				: undefined;
			const method = surface?.methods.find((m) => m.id === example.id);
			if (!method?.examples.some((e) => e.file === example.file)) {
				unattached.push(example.file);
			}
		}
		expect(unattached).toEqual([]);
	});
});
