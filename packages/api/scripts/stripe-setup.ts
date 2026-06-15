#!/usr/bin/env bun
/**
 * Idempotent setup for the Stripe product catalog.
 *
 * Run once per environment (sandbox, then live) against the corresponding
 * STRIPE_SECRET_KEY. Reruns are safe — uses `lookup_key` to find or create.
 * Stripe prices are immutable, so changed amounts archive the old price and
 * create a new one with the same lookup key.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=rk_test_... bun run packages/api/scripts/stripe-setup.ts
 *
 * Prints the IDs at the end — copy the ones with `STRIPE_PRICE_*`
 * prefixes into your .env.
 *
 * What it creates:
 *   - Product "Secondlayer" (single product, per-tier prices attach here)
 *   - Tier prices: Launch $79/mo or $790/yr, Scale $299/mo or $2,990/yr
 *
 * Hobby is intentionally not in Stripe — free tier means no subscription.
 * Enterprise is not in this script — custom-quoted per deal; operator
 * creates those subscriptions by hand in the dashboard.
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
	interval: "month" | "year",
): Promise<Stripe.Price> {
	const existing = await stripe.prices.list({ lookup_keys: [lookupKey] });
	const current = existing.data[0];
	if (
		current &&
		current.unit_amount === amountCents &&
		current.recurring?.interval === interval
	) {
		return current;
	}
	if (current) {
		await stripe.prices.update(current.id, { active: false });
	}

	return stripe.prices.create({
		product: productId,
		nickname,
		unit_amount: amountCents,
		currency: "usd",
		recurring: { interval },
		lookup_key: lookupKey,
		transfer_lookup_key: Boolean(current),
	});
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
	console.log("→ Upserting product…");
	const product = await upsertProduct();
	console.log(`  product=${product.id}`);

	console.log("→ Upserting tier prices (Launch / Scale)…");
	const launchPrice = await upsertTierPrice(
		product.id,
		"secondlayer_launch_monthly",
		7900, // $79.00
		"Launch monthly",
		"month",
	);
	const launchYearlyPrice = await upsertTierPrice(
		product.id,
		"secondlayer_launch_yearly",
		79000, // $790.00, 2 months free
		"Launch yearly",
		"year",
	);
	const scalePrice = await upsertTierPrice(
		product.id,
		"secondlayer_scale_monthly",
		29900, // $299.00
		"Scale monthly",
		"month",
	);
	const scaleYearlyPrice = await upsertTierPrice(
		product.id,
		"secondlayer_scale_yearly",
		299000, // $2,990.00, 2 months free
		"Scale yearly",
		"year",
	);
	console.log(`  price(launch monthly)=${launchPrice.id}`);
	console.log(`  price(launch yearly)=${launchYearlyPrice.id}`);
	console.log(`  price(scale monthly)=${scalePrice.id}`);
	console.log(`  price(scale yearly)=${scaleYearlyPrice.id}`);

	console.log("\n─── Paste into .env ───");
	console.log(`STRIPE_PRICE_LAUNCH=${launchPrice.id}`);
	console.log(`STRIPE_PRICE_LAUNCH_YEARLY=${launchYearlyPrice.id}`);
	console.log(`STRIPE_PRICE_SCALE=${scalePrice.id}`);
	console.log(`STRIPE_PRICE_SCALE_YEARLY=${scaleYearlyPrice.id}`);
}

main().catch((err) => {
	console.error("Setup failed:", err);
	process.exit(1);
});
