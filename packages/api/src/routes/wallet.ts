import { getDb } from "@secondlayer/shared/db";
import { ValidationError } from "@secondlayer/shared/errors";
import { hash160 } from "@secondlayer/stacks/utils";
import { c32address, verifyMessageSignature } from "@secondlayer/stacks/utils";
import { Hono } from "hono";
import { getAccountId } from "../lib/ownership.ts";
import {
	getBalance,
	getMonthlySpend,
	linkWalletHistory,
	upgradeHint,
} from "../x402/balance.ts";

/**
 * Wallet→account continuity (`/api/wallet`, requireAuth via PLATFORM_PATHS).
 *
 * Linking proves wallet ownership with a signed message bound to the calling
 * account (replaying the signature can only ever re-link to the same
 * account), then:
 *   - attaches the wallet's historical x402 payments to the account,
 *   - adopts any wallet-ghost the principal accumulated (subgraphs move
 *     over and their paid-deploy expiry clears — "claiming makes it
 *     permanent"), and
 *   - records the principal on the account for future continuity.
 */

export function linkMessageFor(accountId: string): string {
	return `secondlayer-link-wallet:${accountId}`;
}

function addressFromPublicKey(publicKey: string): string {
	const bytes = Buffer.from(publicKey, "hex");
	return c32address(22, Buffer.from(hash160(bytes)).toString("hex"));
}

type WalletDeps = {
	/** Injectable signature check (tests). */
	verify?: (message: string, signature: string, publicKey: string) => boolean;
};

export function createWalletRouter(deps: WalletDeps = {}) {
	const router = new Hono();
	const verify = deps.verify ?? verifyMessageSignature;

	router.get("/", async (c) => {
		const accountId = getAccountId(c);
		if (!accountId) return c.json({ error: "Unauthorized" }, 401);
		const db = getDb();
		const account = await db
			.selectFrom("accounts")
			.select("wallet_principal")
			.where("id", "=", accountId)
			.executeTakeFirst();
		const principal = account?.wallet_principal ?? null;
		if (!principal) return c.json({ wallet: null });
		const [balance, spent] = await Promise.all([
			getBalance(db, principal),
			getMonthlySpend(db, principal),
		]);
		const spentUsd = Number(spent) / 1_000_000;
		return c.json({
			wallet: principal,
			balance_usd: Number(balance) / 1_000_000,
			spent_this_month_usd: spentUsd,
			...(upgradeHint(spent) ? { upgrade_hint: upgradeHint(spent) } : {}),
		});
	});

	router.post("/link", async (c) => {
		const accountId = getAccountId(c);
		if (!accountId) return c.json({ error: "Unauthorized" }, 401);
		const body = (await c.req.json().catch(() => ({}))) as {
			principal?: string;
			publicKey?: string;
			signature?: string;
		};
		if (!body.principal || !body.publicKey || !body.signature) {
			throw new ValidationError(
				"principal, publicKey, and signature are required",
			);
		}
		const derived = addressFromPublicKey(body.publicKey);
		if (derived !== body.principal) {
			throw new ValidationError("publicKey does not match principal");
		}
		if (!verify(linkMessageFor(accountId), body.signature, body.publicKey)) {
			throw new ValidationError("Invalid wallet signature");
		}

		const db = getDb();
		const me = await db
			.selectFrom("accounts")
			.select(["id", "wallet_principal"])
			.where("id", "=", accountId)
			.executeTakeFirstOrThrow();
		if (me.wallet_principal && me.wallet_principal !== body.principal) {
			return c.json(
				{
					error: "Account already has a linked wallet",
					code: "WALLET_ALREADY_LINKED",
				},
				409,
			);
		}

		const holder = await db
			.selectFrom("accounts")
			.select(["id", "ghost"])
			.where("wallet_principal", "=", body.principal)
			.executeTakeFirst();
		if (holder && holder.id !== accountId && !holder.ghost) {
			return c.json(
				{
					error: "Wallet is linked to another account",
					code: "WALLET_ALREADY_LINKED",
				},
				409,
			);
		}

		let subgraphsAdopted = 0;
		await db.transaction().execute(async (trx) => {
			// Adopt the wallet-ghost: its subgraphs become the account's, paid
			// TTLs clear (claiming makes them permanent), the shell is removed.
			if (holder?.ghost && holder.id !== accountId) {
				const moved = await trx
					.updateTable("subgraphs")
					.set({ account_id: accountId, expires_at: null })
					.where("account_id", "=", holder.id)
					.executeTakeFirst();
				subgraphsAdopted = Number(moved.numUpdatedRows ?? 0n);
				await trx.deleteFrom("accounts").where("id", "=", holder.id).execute();
			}
			await trx
				.updateTable("accounts")
				.set({ wallet_principal: body.principal })
				.where("id", "=", accountId)
				.execute();
		});

		const paymentsLinked = await linkWalletHistory(
			db,
			body.principal,
			accountId,
		);
		const spent = await getMonthlySpend(db, body.principal);
		return c.json({
			wallet: body.principal,
			payments_linked: paymentsLinked,
			subgraphs_adopted: subgraphsAdopted,
			spent_this_month_usd: Number(spent) / 1_000_000,
		});
	});

	return router;
}

export default createWalletRouter();
