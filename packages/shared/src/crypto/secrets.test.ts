import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../db/index.ts";
import {
	SecretsKeyMismatchError,
	ensureSecretsKeyCanary,
} from "../db/queries/instance.ts";
import { generateSecretsKey, secretsKeyAvailable } from "./secrets.ts";

/**
 * Plan f072: `secretsKeyAvailable()` is the non-throwing predicate the
 * subgraph processor uses to decide, BEFORE attempting a decrypt, whether a
 * BYO route can be resolved at all. It must never throw and never leak the
 * key — only report true/false.
 */

type SecretsModule = typeof import("./secrets.ts");

const KEY_ENV = "SECONDLAYER_SECRETS_KEY";
const MODE_ENV = "INSTANCE_MODE";
const originalKey = process.env[KEY_ENV];
const originalMode = process.env[MODE_ENV];
const originalDataDir = process.env.DATA_DIR;
const originalCwd = process.cwd();
const scratch: string[] = [];

afterEach(() => {
	process.chdir(originalCwd);
	if (originalDataDir === undefined) delete process.env.DATA_DIR;
	else process.env.DATA_DIR = originalDataDir;
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true });
	if (originalKey === undefined) delete process.env[KEY_ENV];
	else process.env[KEY_ENV] = originalKey;
	if (originalMode === undefined) delete process.env[MODE_ENV];
	else process.env[MODE_ENV] = originalMode;
});

describe("secretsKeyAvailable", () => {
	test("true when a key is set in the environment", () => {
		process.env[KEY_ENV] = "a".repeat(64);
		expect(secretsKeyAvailable()).toBe(true);
	});

	test("false in platform mode with the env var unset (no OSS file fallback applies)", () => {
		delete process.env[KEY_ENV];
		process.env[MODE_ENV] = "platform";
		expect(secretsKeyAvailable()).toBe(false);
	});

	test("never throws, whether the key is set or unset", () => {
		delete process.env[KEY_ENV];
		process.env[MODE_ENV] = "platform";
		expect(() => secretsKeyAvailable()).not.toThrow();

		process.env[KEY_ENV] = "b".repeat(64);
		expect(() => secretsKeyAvailable()).not.toThrow();
	});
});

describe("OSS key persistence across a container recreate", () => {
	function tempDir(label: string): string {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), `secrets-${label}-`)));
		scratch.push(dir);
		return dir;
	}

	/** A fresh module instance, as a new process would have: no cached key. */
	let boots = 0;
	async function boot(): Promise<SecretsModule> {
		boots += 1;
		return await import(`./secrets.ts?boot=${boots}`);
	}

	test("a recreated container reads the key back from DATA_DIR and still decrypts", async () => {
		const dataDir = tempDir("volume");
		process.env.DATA_DIR = dataDir;
		process.env[MODE_ENV] = "oss";
		delete process.env[KEY_ENV];

		process.chdir(tempDir("container-1"));
		const first = await boot();
		const sealed = first.encryptSecret("whsec_original");
		const firstKey = process.env[KEY_ENV];
		expect(firstKey).toMatch(/^[a-f0-9]{64}$/);
		expect(existsSync(join(dataDir, "secrets.env"))).toBe(true);

		// compose pull && up: new filesystem, same volume, empty environment.
		delete process.env[KEY_ENV];
		process.chdir(tempDir("container-2"));
		const second = await boot();
		expect(second.secretsKeyAvailable()).toBe(true);
		expect(second.decryptSecret(sealed)).toBe("whsec_original");
		expect(process.env[KEY_ENV]).toBe(firstKey);
		expect(existsSync(join(process.cwd(), ".env.local"))).toBe(false);
	});

	test("a key an earlier version left in .env.local moves into DATA_DIR instead of being replaced", async () => {
		const dataDir = tempDir("volume");
		const cwd = tempDir("container");
		const legacyKey = "ab".repeat(32);
		writeFileSync(
			join(cwd, ".env.local"),
			`SECONDLAYER_SECRETS_KEY=${legacyKey}\n`,
		);
		process.env.DATA_DIR = dataDir;
		process.env[MODE_ENV] = "oss";
		delete process.env[KEY_ENV];
		process.chdir(cwd);

		const secrets = await boot();
		secrets.encryptSecret("x");

		expect(process.env[KEY_ENV]).toBe(legacyKey);
		expect(readFileSync(join(dataDir, "secrets.env"), "utf8")).toContain(
			`SECONDLAYER_SECRETS_KEY=${legacyKey}`,
		);
	});

	test("without DATA_DIR the key still lands in .env.local beside the process", async () => {
		const cwd = tempDir("bare");
		delete process.env.DATA_DIR;
		process.env[MODE_ENV] = "oss";
		delete process.env[KEY_ENV];
		process.chdir(cwd);

		const secrets = await boot();
		secrets.encryptSecret("x");

		expect(readFileSync(join(cwd, ".env.local"), "utf8")).toContain(
			`SECONDLAYER_SECRETS_KEY=${process.env[KEY_ENV]}`,
		);
	});

	test("DATA_DIR is created when the volume mount point is missing", async () => {
		const parent = tempDir("parent");
		const dataDir = join(parent, "nested", "data");
		mkdirSync(parent, { recursive: true });
		process.env.DATA_DIR = dataDir;
		process.env[MODE_ENV] = "oss";
		delete process.env[KEY_ENV];
		process.chdir(tempDir("container"));

		const secrets = await boot();
		secrets.encryptSecret("x");

		expect(existsSync(join(dataDir, "secrets.env"))).toBe(true);
	});
});

describe.skipIf(!process.env.DATABASE_URL)(
	"boot check across a container recreate",
	() => {
		afterEach(async () => {
			await getDb().deleteFrom("instances").execute();
		});

		test("the recreated container boots on the key it generated, and a different key is refused", async () => {
			const db = getDb();
			const dataDir = realpathSync(mkdtempSync(join(tmpdir(), "boot-volume-")));
			scratch.push(dataDir);
			process.env.DATA_DIR = dataDir;
			process.env[MODE_ENV] = "oss";
			delete process.env[KEY_ENV];

			process.chdir(realpathSync(mkdtempSync(join(tmpdir(), "boot-c1-"))));
			const first = await import("./secrets.ts?boot=db-1");
			await ensureSecretsKeyCanary(db, {
				keyHex: first.resolveSecretsKeyHex(),
				network: "mainnet",
			});

			delete process.env[KEY_ENV];
			process.chdir(realpathSync(mkdtempSync(join(tmpdir(), "boot-c2-"))));
			const second = await import("./secrets.ts?boot=db-2");
			expect(second.resolveSecretsKeyHex()).toBe(first.resolveSecretsKeyHex());
			await ensureSecretsKeyCanary(db, {
				keyHex: second.resolveSecretsKeyHex(),
				network: "mainnet",
			});

			expect(
				ensureSecretsKeyCanary(db, {
					keyHex: generateSecretsKey(),
					network: "mainnet",
				}),
			).rejects.toBeInstanceOf(SecretsKeyMismatchError);
		});
	},
);
