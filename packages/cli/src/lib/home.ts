import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The CLI's state directory (`~/.secondlayer`), resolved per call and honoring
 * `HOME` explicitly: Bun's `os.homedir()` reads the passwd entry rather than
 * the env, so a test (or an operator running under `HOME=/srv/sl`) would
 * otherwise land on the login user's files. Config and session share it so
 * they can never file under different homes.
 */
export function secondlayerDir(): string {
	return join(process.env.HOME || homedir(), ".secondlayer");
}
