import { describe, expect, test } from "bun:test";
import {
	type BackupConfig,
	backupConfigFromEnv,
	backupTenant,
	finalBackupTenant,
	pruneFinalBackups,
} from "./backups.ts";

function memoryBackups(exitCode = 0): {
	cfg: BackupConfig;
	objects: Map<string, string>;
} {
	const objects = new Map<string, string>();
	return {
		objects,
		cfg: {
			prefix: "tenant-backups",
			store: {
				upload: async (key, body) => {
					objects.set(key, await new Response(body).text());
				},
				list: async (prefix) =>
					[...objects.keys()].filter((k) => k.startsWith(prefix)),
				delete: async (key) => {
					objects.delete(key);
				},
			},
			spawnDump: () => ({
				stdout: new Response("PGDMP").body as ReadableStream<Uint8Array>,
				exited: Promise.resolve(exitCode),
			}),
		},
	};
}

const NOW = new Date("2026-10-15T03:00:00Z");

describe("tenant backups", () => {
	test("a nightly dump lands under the tenant's prefix, named by day", async () => {
		const { cfg, objects } = memoryBackups();
		const { key } = await backupTenant(cfg, "abcd1234", NOW);
		expect(key).toBe("tenant-backups/abcd1234/2026-10-15.dump");
		expect(objects.get(key)).toBe("PGDMP");
	});

	test("backups older than seven days are pruned", async () => {
		const { cfg, objects } = memoryBackups();
		for (const d of ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-14"]) {
			objects.set(`tenant-backups/abcd1234/${d}.dump`, "old");
		}
		objects.set("tenant-backups/ffff0000/2026-10-01.dump", "other tenant");

		const { pruned } = await backupTenant(cfg, "abcd1234", NOW);

		expect(pruned.sort()).toEqual([
			"tenant-backups/abcd1234/2026-10-07.dump",
			"tenant-backups/abcd1234/2026-10-08.dump",
		]);
		expect(objects.has("tenant-backups/abcd1234/2026-10-09.dump")).toBe(true);
		expect(objects.has("tenant-backups/ffff0000/2026-10-01.dump")).toBe(true);
	});

	test("a failed dump leaves no object and prunes nothing", async () => {
		const { cfg, objects } = memoryBackups(1);
		objects.set("tenant-backups/abcd1234/2026-09-01.dump", "last good");

		await expect(backupTenant(cfg, "abcd1234", NOW)).rejects.toThrow(
			"pg_dump failed",
		);
		expect([...objects.keys()]).toEqual([
			"tenant-backups/abcd1234/2026-09-01.dump",
		]);
	});

	test("destroy-time dumps are kept thirty days", async () => {
		const { cfg, objects } = memoryBackups();
		const key = await finalBackupTenant(cfg, "abcd1234", NOW);
		expect(key).toBe("tenant-backups/final/abcd1234/2026-10-15.dump");
		objects.set("tenant-backups/final/ffff0000/2026-09-10.dump", "old");
		objects.set("tenant-backups/final/eeee0000/2026-09-20.dump", "recent");

		expect(await pruneFinalBackups(cfg, NOW)).toEqual([
			"tenant-backups/final/ffff0000/2026-09-10.dump",
		]);
		expect(objects.has(key)).toBe(true);
		expect(objects.has("tenant-backups/final/eeee0000/2026-09-20.dump")).toBe(
			true,
		);
	});

	test("backups are off unless every TENANT_BACKUP_* credential is set", () => {
		expect(backupConfigFromEnv({})).toBeNull();
		expect(
			backupConfigFromEnv({
				TENANT_BACKUP_BUCKET: "b",
				TENANT_BACKUP_ENDPOINT: "https://example.r2",
				TENANT_BACKUP_ACCESS_KEY_ID: "id",
			}),
		).toBeNull();
		expect(
			backupConfigFromEnv({
				TENANT_BACKUP_BUCKET: "b",
				TENANT_BACKUP_ENDPOINT: "https://example.r2",
				TENANT_BACKUP_ACCESS_KEY_ID: "id",
				TENANT_BACKUP_SECRET_ACCESS_KEY: "secret",
			})?.prefix,
		).toBe("tenant-backups");
	});
});
