import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { dirname } from "node:path";

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const text = await readFile(path, "utf-8");
  return JSON.parse(text) as T;
}

export async function writeTextFile(path: string, content: string): Promise<void> {
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
