import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	slugifyProjectName,
	validateProjectSlug,
} from "../src/commands/project.ts";

interface ProjectCreateRequest {
	name: string;
	slug: string;
}

let mockServer: ReturnType<typeof Bun.serve> | undefined;
let nextMockPort = 19613;

afterEach(() => {
	mockServer?.stop();
	mockServer = undefined;
});

describe("project slug helpers", () => {
	test("slugifies project names", () => {
		expect(slugifyProjectName("My App")).toBe("my-app");
		expect(slugifyProjectName("caf\u00e9")).toBe("caf");
		expect(slugifyProjectName(" -- My...App__Name -- ")).toBe("my-app-name");
	});

	test("caps slug length and trims trailing hyphens after truncation", () => {
		const slug = slugifyProjectName(`${"a".repeat(62)} ${"b".repeat(20)}`);

		expect(slugifyProjectName("a".repeat(70))).toHaveLength(63);
		expect(slug).toHaveLength(62);
		expect(slug.endsWith("-")).toBe(false);
	});

	test("validates project slug format", () => {
		expect(validateProjectSlug("my-app")).toBe(true);
		expect(validateProjectSlug("a")).toBe(
			"Project slug must be 2-63 characters",
		);
		expect(validateProjectSlug("my_app")).toBe(
			"Project slug must use lowercase letters, numbers, and hyphens, and start/end with a letter or number",
		);
		expect(validateProjectSlug("my-app-")).toBe(
			"Project slug must use lowercase letters, numbers, and hyphens, and start/end with a letter or number",
		);
	});
});

describe("project create command", () => {
	test("sends derived slug, reads flat response, and binds project", async () => {
		const requests: ProjectCreateRequest[] = [];
		mockServer = startProjectServer(requests);
		const env = await createCliEnv();

		const result = await runCli(env, ["project", "create", "My App"]);

		expect(result.exitCode).toBe(0);
		expect(requests).toEqual([{ name: "My App", slug: "my-app" }]);
		expect(result.output).toContain("Created project My App (my-app)");
		const projectFile = JSON.parse(
			await readFile(join(env.cwd, ".secondlayer", "project"), "utf8"),
		);
		expect(projectFile).toEqual({ slug: "my-app" });

		await env.cleanup();
	});

	test("uses explicit slug override", async () => {
		const requests: ProjectCreateRequest[] = [];
		mockServer = startProjectServer(requests);
		const env = await createCliEnv();

		const result = await runCli(env, [
			"project",
			"create",
			"My App",
			"--slug",
			"custom-app",
		]);

		expect(result.exitCode).toBe(0);
		expect(requests).toEqual([{ name: "My App", slug: "custom-app" }]);

		await env.cleanup();
	});

	test("surfaces duplicate slug errors from the platform", async () => {
		const requests: ProjectCreateRequest[] = [];
		mockServer = startProjectServer(requests);
		const env = await createCliEnv();

		const result = await runCli(env, [
			"project",
			"create",
			"My App",
			"--slug",
			"taken",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Slug already exists");

		await env.cleanup();
	});
});

function startProjectServer(requests: ProjectCreateRequest[]) {
	return Bun.serve({
		port: nextMockPort++,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname !== "/api/projects" || req.method !== "POST") {
				return new Response("Not Found", { status: 404 });
			}

			const body = (await req.json()) as ProjectCreateRequest;
			requests.push(body);

			if (body.slug === "taken") {
				return Response.json({ error: "Slug already exists" }, { status: 409 });
			}

			return Response.json(
				{
					id: "00000000-0000-4000-8000-000000000001",
					name: body.name,
					slug: body.slug,
					network: "mainnet",
					createdAt: "2026-04-29T00:00:00.000Z",
				},
				{ status: 201 },
			);
		},
	});
}

async function createCliEnv(): Promise<{
	cwd: string;
	home: string;
	cleanup: () => Promise<void>;
}> {
	const root = await mkdtemp(join(tmpdir(), "secondlayer-project-test-"));
	const cwd = join(root, "work");
	const home = join(root, "home");
	await mkdir(cwd, { recursive: true });
	await mkdir(join(home, ".secondlayer"), { recursive: true });
	await writeFile(
		join(home, ".secondlayer", "session.json"),
		JSON.stringify({
			token: "ss-sl_test",
			email: "test@example.com",
			accountId: "00000000-0000-4000-8000-000000000002",
			expiresAt: "2027-04-29T00:00:00.000Z",
		}),
		"utf8",
	);

	return {
		cwd,
		home,
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

async function runCli(
	env: { cwd: string; home: string },
	args: string[],
): Promise<{ exitCode: number; output: string }> {
	const proc = Bun.spawn({
		cmd: [
			"bun",
			resolve("packages/cli/tests/fixtures/project-cli.ts"),
			...args,
		],
		cwd: env.cwd,
		env: {
			...process.env,
			HOME: env.home,
			SL_PLATFORM_API_URL: `http://localhost:${mockServer?.port}`,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return {
		exitCode,
		output: `${stdout}${stderr}`,
	};
}
