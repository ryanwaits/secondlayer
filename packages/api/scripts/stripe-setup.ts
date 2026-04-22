#!/usr/bin/env bun
/**
 * Idempotent setup for the Stripe product catalog.
 *
 * Run once per environment (sandbox, then live) against the corresponding
 * STRIPE_SECRET_KEY. Reruns are safe — uses `lookup_key` to find or create.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=rk_test_... bun run packages/api/scripts/stripe-setup.ts
 *
 * Prints the IDs at the end — copy the ones with `STRIPE_PRICE_*` and
 * `STRIPE_METER_*` prefixes into your .env.
 *
 * What it creates:
 *   - Product "Secondlayer" (single product, per-tier prices attach here)
 *   - Price: Pro monthly, $25/mo recurring, lookup_key=secondlayer_pro_monthly
 *   - Meters: compute_hours, storage_gb_months, ai_evals (metered usage)
 *   - Prices attached to each meter for overage billing
 *
 * Enterprise: intentionally NOT created here. Enterprise is custom-quoted
 * per deal; operator creates those subscriptions by hand in the dashboard.
 */

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
	console.error("STRIPE_SECRET_KEY is required");
	process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-03-25.dahlia" });

// ── Product ───────────────────────────────────────────────────────────

const PRODUCT_METADATA_KEY = "secondlayer_id";
const PRODUCT_METADATA_VALUE = "platform";

async function upsertProduct(): Promise<Stripe.Product> {
	// Stripe has no lookup_key on products, so we use metadata. Search for
	// an existing product tagged with ours; create if missing.
	const existing = await stripe.products.search({
		query: `metadata['${PRODUCT_METADATA_KEY}']:'${PRODUCT_METADATA_VALUE}' AND active:'true'`,
		limit: 1,
	});
	if (existing.data[0]) return existing.data[0];

	return stripe.products.create({
		name: "Secondlayer",
		description: "Dedicated Stacks indexing + real-time subgraphs.",
		metadata: { [PRODUCT_METADATA_KEY]: PRODUCT_METADATA_VALUE },
	});
}

// ── Tier prices ───────────────────────────────────────────────────────

async function upsertTierPrice(
	productId: string,
	lookupKey: string,
	amountCents: number,
	nickname: string,
): Promise<Stripe.Price> {
	const existing = await stripe.prices.list({ lookup_keys: [lookupKey] });
	if (existing.data[0]) return existing.data[0];

	return stripe.prices.create({
		product: productId,
		nickname,
		unit_amount: amountCents,
		currency: "usd",
		recurring: { interval: "month" },
		lookup_key: lookupKey,
	});
}

// ── Meters ────────────────────────────────────────────────────────────
//
// A Stripe billing meter defines the event name (`event_name`) and how
// events aggregate. Its id is referenced by meter-metered prices.

interface MeterDef {
	eventName: string;
	displayName: string;
	aggregation: "sum" | "count" | "last";
}

const METERS: MeterDef[] = [
	{
		eventName: "compute_hours",
		displayName: "Compute hours",
		aggregation: "sum",
	},
	{
		eventName: "storage_gb_months",
		displayName: "Storage GB-months",
		aggregation: "sum",
	},
	{
		eventName: "ai_evals",
		displayName: "AI evaluations (overage)",
		aggregation: "sum",
	},
];

async function upsertMeter(def: MeterDef): Promise<Stripe.Billing.Meter> {
	const existing = await stripe.billing.meters.list({ limit: 100 });
	const found = existing.data.find((m) => m.event_name === def.eventName);
	if (found && found.status === "active") return found;

	return stripe.billing.meters.create({
		display_name: def.displayName,
		event_name: def.eventName,
		default_aggregation: { formula: def.aggregation },
		customer_mapping: {
			event_payload_key: "stripe_customer_id",
			type: "by_id",
		},
		value_settings: { event_payload_key: "value" },
	});
}

// Metered prices — attached to a meter, billed per-unit overage.
async function upsertMeteredPrice(
	productId: string,
	lookupKey: string,
	meterId: string,
	perUnitCents: number,
	nickname: string,
): Promise<Stripe.Price> {
	const existing = await stripe.prices.list({ lookup_keys: [lookupKey] });
	if (existing.data[0]) return existing.data[0];

	return stripe.prices.create({
		product: productId,
		nickname,
		currency: "usd",
		recurring: {
			interval: "month",
			usage_type: "metered",
			meter: meterId,
		},
		// SDK types `unit_amount_decimal` as a branded Decimal, but the
		// runtime accepts a plain string. Cast narrows the compiler while
		// keeping the original intent.
		// biome-ignore lint/suspicious/noExplicitAny: Stripe Decimal branded type.
		unit_amount_decimal: perUnitCents.toString() as any,
		lookup_key: lookupKey,
	});
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
	console.log("→ Upserting product…");
	const product = await upsertProduct();
	console.log(`  product=${product.id}`);

	console.log("→ Upserting Pro tier price (legacy, kept for back-compat)…");
	const proPrice = await upsertTierPrice(
		product.id,
		"secondlayer_pro_monthly",
		2500, // $25.00
		"Pro monthly",
	);
	console.log(`  price(pro)=${proPrice.id}`);

	console.log("→ Upserting tier prices (Launch / Grow / Scale)…");
	const launchPrice = await upsertTierPrice(
		product.id,
		"secondlayer_launch_monthly",
		14900, // $149.00
		"Launch monthly",
	);
	const growPrice = await upsertTierPrice(
		product.id,
		"secondlayer_grow_monthly",
		34900, // $349.00
		"Grow monthly",
	);
	const scalePrice = await upsertTierPrice(
		product.id,
		"secondlayer_scale_monthly",
		79900, // $799.00
		"Scale monthly",
	);
	console.log(`  price(launch)=${launchPrice.id}`);
	console.log(`  price(grow)=${growPrice.id}`);
	console.log(`  price(scale)=${scalePrice.id}`);

	console.log("→ Upserting meters…");
	const meters: Record<string, Stripe.Billing.Meter> = {};
	for (const def of METERS) {
		const meter = await upsertMeter(def);
		meters[def.eventName] = meter;
		console.log(`  meter(${def.eventName})=${meter.id}`);
	}

	console.log("→ Upserting metered prices…");
	// Per-unit pricing is placeholder — revisit in the metering sprint
	// once we've calibrated overage rates against actual infra cost.
	const computePrice = await upsertMeteredPrice(
		product.id,
		"secondlayer_compute_overage",
		meters.compute_hours.id,
		5, // $0.05/hour
		"Compute overage",
	);
	const storagePrice = await upsertMeteredPrice(
		product.id,
		"secondlayer_storage_overage",
		meters.storage_gb_months.id,
		200, // $2.00/GB-month
		"Storage overage",
	);
	const aiPrice = await upsertMeteredPrice(
		product.id,
		"secondlayer_ai_overage",
		meters.ai_evals.id,
		1, // $0.01/eval (fill in real per-eval cost later)
		"AI eval overage",
	);
	console.log(`  price(compute)=${computePrice.id}`);
	console.log(`  price(storage)=${storagePrice.id}`);
	console.log(`  price(ai)=${aiPrice.id}`);

	console.log("\n─── Paste into .env ───");
	console.log(`STRIPE_PRICE_LAUNCH=${launchPrice.id}`);
	console.log(`STRIPE_PRICE_GROW=${growPrice.id}`);
	console.log(`STRIPE_PRICE_SCALE=${scalePrice.id}`);
	console.log(`STRIPE_PRICE_PRO=${proPrice.id}  # legacy, optional`);
	console.log(`STRIPE_METER_COMPUTE=${meters.compute_hours.id}`);
	console.log(`STRIPE_METER_STORAGE=${meters.storage_gb_months.id}`);
	console.log(`STRIPE_METER_AI_EVALS=${meters.ai_evals.id}`);
	console.log(`STRIPE_PRICE_COMPUTE_OVERAGE=${computePrice.id}`);
	console.log(`STRIPE_PRICE_STORAGE_OVERAGE=${storagePrice.id}`);
	console.log(`STRIPE_PRICE_AI_OVERAGE=${aiPrice.id}`);
}

main().catch((err) => {
	console.error("Setup failed:", err);
	process.exit(1);
});
