import { createHash } from "node:crypto";
import {
	mkdir,
	open,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";

export async function readTextFile(path: string): Promise<string> {
	return readFile(path, "utf-8");
}

export async function readJsonFile<T>(path: string): Promise<T> {
	const text = await readFile(path, "utf-8");
	return JSON.parse(text) as T;
}

export async function writeTextFile(
	path: string,
	content: string,
): Promise<void> {
	await writeFile(path, content, "utf-8");
}

export async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function ensureDir(path: string): Promise<void> {
	await mkdir(path, { recursive: true });
}

export async function removeFile(path: string): Promise<void> {
	await unlink(path);
}

/**
 * Hashed in fixed 1 MiB reads so a mainnet dump, which runs to many
 * gigabytes, never has to fit in one Buffer: `readFileSync` caps at 2 GiB
 * under Node and would take a backup down after pg_dump had already spent
 * its hour.
 */
export async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256");
	const chunk = Buffer.allocUnsafe(1024 * 1024);
	const fh = await open(path, "r");
	try {
		let position = 0;
		for (;;) {
			const { bytesRead } = await fh.read(chunk, 0, chunk.length, position);
			if (bytesRead === 0) break;
			hash.update(chunk.subarray(0, bytesRead));
			position += bytesRead;
		}
	} finally {
		await fh.close();
	}
	return hash.digest("hex");
}
