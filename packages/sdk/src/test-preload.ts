/**
 * Runs before every test file (bunfig.toml `[test] preload`). A developer's
 * shell often exports real credentials (SECONDLAYER_API_KEY, a hosted
 * SECONDLAYER_API_URL), and modules read them at import time. Tests start from
 * a blank slate instead; a test that needs one sets it itself.
 */
for (const name of Object.keys(process.env)) {
	if (
		name.startsWith("SECONDLAYER_") ||
		name.startsWith("SL_") ||
		name === "INSTANCE_TOKEN" ||
		name === "STACKS_NETWORK"
	) {
		delete process.env[name];
	}
}
