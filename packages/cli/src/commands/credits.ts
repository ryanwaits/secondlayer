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
	refill?: {
		belowUsd: number | null;
		packUsd: number | null;
		lastAt: string | null;
	};
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
					"After payment: SL_API_URL=https://api.secondlayer.tools secondlayer login && secondlayer credits balance",
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
			const refill = res.refill;
			console.log(
				formatKeyValue([
					["Balance", `$${usd.toFixed(2)}`],
					[
						"Refill",
						refill?.belowUsd != null
							? `on — below $${refill.belowUsd} buy $${refill.packUsd}`
							: dim("off"),
					],
					[
						"Buy",
						dim("secondlayer credits buy --email you@example.com --pack 25"),
					],
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

	credits
		.command("refill")
		.description("Opt-in auto-refill when the balance drops under a threshold")
		.option("--below <usd>", "Trigger when balance is under this USD amount")
		.option("--pack <usd>", `Pack to buy (${PACKS.join(", ")})`, "25")
		.option("--off", "Turn auto-refill off")
		.option("--json", "Output as JSON")
		.action(
			(opts: {
				below?: string;
				pack: string;
				off?: boolean;
				json?: boolean;
			}) => runRefill(opts),
		);
}

async function runRefill(opts: {
	below?: string;
	pack: string;
	off?: boolean;
	json?: boolean;
}): Promise<void> {
	if (!opts.off && opts.below === undefined) {
		await runBalance(opts);
		return;
	}

	const body = opts.off
		? { belowUsd: null }
		: { belowUsd: Number(opts.below), packUsd: parsePack(opts.pack) };

	if (
		!opts.off &&
		(!Number.isFinite(body.belowUsd) || (body.belowUsd ?? 0) < 1)
	) {
		logError("--below must be at least 1");
		process.exit(1);
	}

	let res: { belowUsd: number | null; packUsd: number | null };
	try {
		res = await httpArchiveOps("/api/billing/refill", {
			method: "POST",
			body,
		});
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
			if (res.belowUsd == null) {
				success("Auto-refill off");
				return;
			}
			success(`Auto-refill on — below $${res.belowUsd} buy $${res.packUsd}`);
		},
	});
}
