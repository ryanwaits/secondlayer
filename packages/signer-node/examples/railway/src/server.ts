import { createSignerService } from "@secondlayer/signer-node";
import {
	allowlistFunctions,
	composePolicies,
	dailyCapMicroStx,
} from "@secondlayer/signer-node/policy";

const privateKeyHex = required("STACKS_PRIVATE_KEY");
const hmacSecret = required("SECONDLAYER_HMAC");

// Customize your policy. Default is deny-all; spell out what you permit.
const policy = composePolicies(
	allowlistFunctions({
		// "SP123...abc.dex-swap-v2": ["swap-usdc-for-stx", "swap-stx-for-usdc"],
	}),
	dailyCapMicroStx(BigInt(process.env.DAILY_CAP_MICROSTX ?? "1000000000")),
);

const app = createSignerService({ privateKeyHex, hmacSecret, policy });

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
Bun.serve({ fetch: app.fetch, port });
console.log(`✓ Secondlayer signer listening on :${port}`);

function required(name: string): string {
	const v = process.env[name];
	if (!v) {
		console.error(`missing required env var: ${name}`);
		process.exit(1);
	}
	return v;
}
