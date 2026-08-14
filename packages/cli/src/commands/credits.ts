import type { Command } from "commander";
import {
	CliHttpError,
	httpArchiveOps,
	httpArchiveOpsAnon,
} from "../lib/http.ts";
import {
	dim,
	formatKeyValue,
	error as logError,
	output,
	success,
} from "../lib/output.ts";

const PACKS = [10, 25, 50, 100] as const;

interface CheckoutResponse {
	url: string;
}

interface BillingStatusResponse {
	creditsUsdMicros?: string;
	plan?: string;
}

function parsePack(raw: string): number {
	const n = Number(raw);
	if (!(PACKS as readonly number[]).includes(n)) {
		logError(`--pack must be one of ${PACKS.join(", ")}`);
		process.exit(1);
	}
	return n;
}

async function runBuy(opts: {
	email: string;
	pack: string;
	json?: boolean;
}): Promise<void> {
	const email = opts.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		logError("--email must be a valid address");
		process.exit(1);
	}
	const amount = parsePack(opts.pack);
	let res: CheckoutResponse;
	try {
		res = await httpArchiveOpsAnon<CheckoutResponse>(
			"/api/public/credits/checkout",
			{ method: "POST", body: { email, amount } },
		);
	} catch (err) {
		if (err instanceof CliHttpError) {
			logError(err.message);
			process.exit(1);
		}
		throw err;
	}
	output({
		json: opts.json,
		data: res,
		human: () => {
			success(`Checkout for $${amount} → ${email}`);
			console.log(res.url);
			console.log(
				dim(
					"After payment: SL_API_URL=https://api.secondlayer.tools sl login && sl credits balance",
				),
			);
		},
	});
}

async function runBalance(opts: { json?: boolean }): Promise<void> {
	let res: BillingStatusResponse;
	try {
		res = await httpArchiveOps<BillingStatusResponse>("/api/billing/status");
	} catch (err) {
		if (err instanceof CliHttpError) {
			logError(err.message);
			process.exit(1);
		}
		throw err;
	}
	const micros = BigInt(res.creditsUsdMicros ?? "0");
	const usd = Number(micros) / 1_000_000;
	output({
		json: opts.json,
		data: { creditsUsd: usd, creditsUsdMicros: micros.toString() },
		human: () => {
			console.log(
				formatKeyValue([
					["Balance", `$${usd.toFixed(2)}`],
					["Buy", dim("sl credits buy --email you@example.com --pack 25")],
				]),
			);
		},
	});
}

export function registerCreditsCommand(program: Command): void {
	const credits = program
		.command("credits")
		.description("Buy and check archive credits");

	credits
		.command("buy")
		.description("Open a one-time Stripe checkout for archive credits")
		.requiredOption("--email <email>", "Receipt email; becomes the account")
		.option("--pack <usd>", `One of ${PACKS.join(", ")}`, "25")
		.option("--json", "Output as JSON")
		.action((opts: { email: string; pack: string; json?: boolean }) =>
			runBuy(opts),
		);

	credits
		.command("balance")
		.description("Show prepaid archive credit balance")
		.option("--json", "Output as JSON")
		.action((opts: { json?: boolean }) => runBalance(opts));
}
