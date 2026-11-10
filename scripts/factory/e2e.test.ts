import { expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FACTORY = "/Users/ryan/projects/factory";
const here = import.meta.dir;
const archive = join(here, "../../plans/assets/344-dogfood/export-20261110");

const ticket = (id: string, route: string) => ({
	id,
	intent: `ticket ${id}`,
	expected: null,
	kind_hint: null,
	evidence: null,
	attempted: null,
	origin: "sdk",
	status: "classified",
	route,
	classification: { reason: "test" },
	created_at: "2026-11-01T00:00:00.000Z",
});

test.skipIf(
	!existsSync(`${FACTORY}/packages/cli/cli.ts`) || !existsSync(archive),
)(
	"real factory pulls both adapters, then pulls nothing new",
	async () => {
		const tmp = realpathSync(mkdtempSync(join(tmpdir(), "sl-e2e-")));
		const home = join(tmp, "home");
		const repo = join(tmp, "project");
		const stubRepo = join(tmp, "stub");
		mkdirSync(home);
		mkdirSync(join(stubRepo, "scripts/ops"), { recursive: true });
		mkdirSync(repo);

		// Stub ops script: canned rows, no database.
		const rows = [
			ticket("t-1", "docs"),
			ticket("t-2", "human"),
			ticket("t-3", "low_priority"),
		];
		writeFileSync(
			join(stubRepo, "scripts/ops/feedback-queue.ts"),
			`console.log(${JSON.stringify(JSON.stringify(rows))});`,
		);
		writeFileSync(
			join(home, "config.ts"),
			`import { secondlayerFeedback } from ${JSON.stringify(join(here, "feedback.ts"))};
import { dogfoodArchive } from ${JSON.stringify(join(here, "dogfood-archive.ts"))};
export default () => ({
	adapters: [
		dogfoodArchive({ dir: ${JSON.stringify(archive)}, project: "SL" }),
		secondlayerFeedback({ repo: ${JSON.stringify(stubRepo)}, project: "SL" }),
	],
});
`,
		);

		const env = { ...process.env, FACTORY_HOME: home } as Record<
			string,
			string
		>;
		// Never let the factory see a GitHub token or a database.
		for (const k of [
			"GH_TOKEN",
			"GITHUB_TOKEN",
			"FACTORY_PAT",
			"DATABASE_URL",
			"TARGET_DATABASE_URL",
		])
			delete env[k];
		const factory = async (...args: string[]) => {
			const p = Bun.spawn(["bun", `${FACTORY}/packages/cli/cli.ts`, ...args], {
				cwd: repo,
				env,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [out, err] = await Promise.all([
				new Response(p.stdout).text(),
				new Response(p.stderr).text(),
			]);
			return { code: await p.exited, out, err };
		};
		const git = (...a: string[]) =>
			Bun.spawnSync(["git", ...a], {
				cwd: repo,
				env: {
					...env,
					GIT_AUTHOR_NAME: "t",
					GIT_AUTHOR_EMAIL: "t@t",
					GIT_COMMITTER_NAME: "t",
					GIT_COMMITTER_EMAIL: "t@t",
				},
			});
		git("init", "-b", "main");
		writeFileSync(join(repo, "README.md"), "x\n");
		git("add", "README.md");
		git("commit", "-m", "init");

		expect((await factory("project", "add", repo, "--key", "SL")).code).toBe(0);

		const first = await factory("pull");
		expect(first.code).toBe(0);
		const list = async () =>
			JSON.parse((await factory("ls", "--json")).out) as {
				source?: { adapter?: string };
			}[];
		let items = await list();
		const count = (name: string) =>
			items.filter((i) => i.source?.adapter === name).length;
		expect(count("dogfood-archive")).toBe(23);
		// t-1 and t-2 come from both the customer and the internal call (stub ignores --internal).
		expect(count("secondlayer-feedback")).toBe(2);
		expect(items).toHaveLength(25);

		const second = await factory("pull");
		expect(second.code).toBe(0);
		items = await list();
		expect(items).toHaveLength(25);
	},
	120_000,
);
