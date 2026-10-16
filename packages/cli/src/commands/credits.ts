import type { Command } from "commander";
import {
	CliHttpError,
	httpArchiveOps,
	httpArchiveOpsAnon,
} from "../lib/http.ts";
import {
	dim,
	formatKeyValue,
	formatTable,
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

/** The slice of `GET /api/billing/rows` this command prints. */
interface RowsUsageResponse {
	allowance: {
		monthly: number;
		usedThisMonth: number;
		exhaustedOn: string | null;
	};
	daily: {
		date: string;
		source: string;
		rows: number;
		freeRows: number;
		paidRows: number;
	}[];
	bySource: { source: string; rows: number; calls: number }[];
}

export type RowsUsageDay = {
	date: string;
	rows: number;
	free: number;
	paid: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** One line per UTC day for the last `days` days ending with `now`'s day,
 *  oldest first, sources summed and quiet days zero-filled. */
export function rowsUsageDays(
	daily: RowsUsageResponse["daily"],
	days: number,
	now: Date,
): RowsUsageDay[] {
	const byDate = new Map<string, RowsUsageDay>();
	for (const d of daily) {
		const day = byDate.get(d.date) ?? {
			date: d.date,
			rows: 0,
			free: 0,
			paid: 0,
		};
		day.rows += d.rows;
		day.free += d.freeRows;
		day.paid += d.paidRows;
		byDate.set(d.date, day);
	}
	const today = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	return Array.from({ length: days }, (_, i) => {
		const date = new Date(today - (days - 1 - i) * DAY_MS)
			.toISOString()
			.slice(0, 10);
		return byDate.get(date) ?? { date, rows: 0, free: 0, paid: 0 };
	});
}

function parseDays(raw: string): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1 || n > 30) {
		logError("--days must be a whole number from 1 to 30");
		process.exit(1);
	}
	return n;
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
					"After payment: set SECONDLAYER_API_KEY (or run `secondlayer login --credits`), then run `secondlayer credits balance`",
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

async function runUsage(opts: {
	days: string;
	json?: boolean;
}): Promise<void> {
	const days = parseDays(opts.days);
	let res: RowsUsageResponse;
	try {
		res = await httpArchiveOps<RowsUsageResponse>("/api/billing/rows");
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
			const n = (v: number) => v.toLocaleString("en-US");
			const lines = rowsUsageDays(res.daily, days, new Date());
			console.log(
				formatTable(
					["Date", "Rows", "Free", "Paid"],
					lines.map((d) => [d.date, n(d.rows), n(d.free), n(d.paid)]),
				),
			);
			console.log();
			const { allowance } = res;
			const pairs: [string, string][] = [
				[
					"This month",
					`${n(allowance.usedThisMonth)} rows, ${n(allowance.monthly)} free${
						allowance.exhaustedOn ? ` (used up ${allowance.exhaustedOn})` : ""
					}`,
				],
			];
			for (const source of res.bySource) {
				const name = source.source === "streams" ? "Streams" : "Index";
				pairs.push([
					name,
					`${n(source.rows)} rows, ${n(source.calls)} calls, 30 days`,
				]);
			}
			console.log(formatKeyValue(pairs));
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
		.command("usage")
		.description("Rows delivered per day: free vs paid, by source")
		.option("--days <n>", "Days to show (max 30)", "30")
		.option("--json", "Output as JSON")
		.action((opts: { days: string; json?: boolean }) => runUsage(opts));

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
