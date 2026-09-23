"use client";

import { MarketingNav } from "@/components/marketing-nav";
import { useAuth } from "@/lib/auth";
import { takeHandedOverKey } from "@/lib/new-key";
import type { ApiKey } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

/** Credit packs the API sells (`CREDIT_PACKS_USD` in packages/api). */
const PACKS_USD = [10, 25, 50, 100] as const;

type Billing = { creditsUsdMicros: string; spentThisMonthUsdMicros: string };

function formatDate(iso: string | null): string {
	if (!iso) return "never";
	return new Date(iso).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatUsd(micros: string): string {
	return `$${(Number(micros) / 1_000_000).toFixed(2)}`;
}

/** A key's full value, shown once, with the one thing to do about it. */
function NewKey({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="account-newkey">
			<p className="account-newkey-title">Your API key</p>
			<p className="login-disclaimer">
				Copy it now. It isn't stored, so this is the only time it's shown.
			</p>
			<div className="account-newkey-row">
				<code>{value}</code>
				<button
					type="button"
					className="account-copy"
					onClick={() => {
						navigator.clipboard.writeText(value);
						setCopied(true);
						setTimeout(() => setCopied(false), 1400);
					}}
				>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<pre className="account-snippet">{`export SECONDLAYER_API_KEY=${value}`}</pre>
		</div>
	);
}

export default function AccountPage() {
	const { account, loading } = useAuth();
	const [newKey, setNewKey] = useState<string | null>(null);
	const [keys, setKeys] = useState<ApiKey[] | null>(null);
	const [billing, setBilling] = useState<Billing | null>(null);
	const [topup, setTopup] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const loadKeys = useCallback(async () => {
		const res = await fetch("/api/keys");
		if (!res.ok) return;
		const data = (await res.json()) as { keys: ApiKey[] };
		setKeys(data.keys);
	}, []);

	const loadBilling = useCallback(async () => {
		const res = await fetch("/api/billing/status");
		if (res.ok) setBilling((await res.json()) as Billing);
	}, []);

	useEffect(() => {
		setNewKey(takeHandedOverKey());
		// Back from Stripe: say so once, then tidy the URL.
		const params = new URLSearchParams(location.search);
		const result = params.get("topup");
		if (result) {
			setTopup(result);
			history.replaceState(null, "", location.pathname);
		}
	}, []);

	useEffect(() => {
		if (!account) return;
		loadKeys();
		loadBilling();
	}, [account, loadKeys, loadBilling]);

	async function createKey() {
		setBusy("create");
		setError(null);
		try {
			const res = await fetch("/api/keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Created on /account" }),
			});
			const data = (await res.json()) as { key?: string; error?: string };
			if (!res.ok || !data.key) {
				setError(data.error ?? "Couldn't create a key");
				return;
			}
			setNewKey(data.key);
			await loadKeys();
		} finally {
			setBusy(null);
		}
	}

	async function revokeKey(key: ApiKey) {
		if (
			!window.confirm(
				`Revoke ${key.prefix}…? Anything using it stops working right away.`,
			)
		) {
			return;
		}
		setBusy(key.id);
		setError(null);
		try {
			const res = await fetch(`/api/keys/${key.id}`, { method: "DELETE" });
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				setError(data.error ?? "Couldn't revoke that key");
				return;
			}
			await loadKeys();
		} finally {
			setBusy(null);
		}
	}

	async function buyCredits(amount: number) {
		setBusy(`pack-${amount}`);
		setError(null);
		try {
			const res = await fetch("/api/billing/topup", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ amount }),
			});
			const data = (await res.json()) as { url?: string; error?: string };
			if (!res.ok || !data.url) {
				setError(data.error ?? "Couldn't start checkout");
				setBusy(null);
				return;
			}
			window.location.href = data.url;
		} catch {
			setError("Couldn't start checkout");
			setBusy(null);
		}
	}

	if (loading) {
		return (
			<div className="login-page">
				<MarketingNav />
			</div>
		);
	}

	if (!account) {
		return (
			<div className="login-page">
				<MarketingNav />
				<div className="login-card">
					<span className="login-eyebrow">Account</span>
					<h1 className="login-title">Sign in to get a key</h1>
					<p className="login-disclaimer">
						Your API key reads the hosted API at api.secondlayer.tools.
					</p>
					<a href="/login" className="login-submit account-link-button">
						Sign in
					</a>
				</div>
			</div>
		);
	}

	const active = (keys ?? []).filter((k) => k.status === "active");

	return (
		<div className="login-page">
			<MarketingNav />
			<div className="login-card account-card">
				<span className="login-eyebrow">Account</span>
				<h1 className="login-title">API keys</h1>
				<p className="login-disclaimer">
					Signed in as <strong>{account.email}</strong>. A key reads the hosted
					API: send it as <code>Authorization: Bearer</code>.
				</p>

				{newKey ? <NewKey value={newKey} /> : null}

				<div className="account-keys">
					{active.length === 0 && keys !== null ? (
						<p className="login-disclaimer">No keys yet.</p>
					) : null}
					{active.map((k) => (
						<div key={k.id} className="account-key">
							<code>{k.prefix}…</code>
							<span>{k.name}</span>
							<button
								type="button"
								className="account-revoke"
								onClick={() => revokeKey(k)}
								disabled={busy === k.id}
							>
								{busy === k.id ? "Revoking..." : "Revoke"}
							</button>
							<span className="account-key-meta">
								created {formatDate(k.createdAt)} · last used{" "}
								{formatDate(k.lastUsedAt)}
							</span>
						</div>
					))}
				</div>

				<button
					type="button"
					className="login-submit"
					onClick={createKey}
					disabled={busy === "create"}
				>
					{busy === "create" ? "Creating..." : "Create a new key"}
				</button>

				<h2 className="account-section-title">Credits</h2>
				{topup === "success" ? (
					<p className="account-notice">
						Payment received. Credits appear here within a few seconds of Stripe
						confirming it; refresh if the balance hasn't moved yet.
					</p>
				) : null}
				{topup === "cancelled" ? (
					<p className="login-disclaimer">
						Checkout cancelled. Nothing was charged.
					</p>
				) : null}
				<div className="account-balance">
					<div>
						<span className="account-balance-label">Balance</span>
						<span className="account-balance-value">
							{billing ? formatUsd(billing.creditsUsdMicros) : "..."}
						</span>
					</div>
					<div>
						<span className="account-balance-label">Spent this month</span>
						<span className="account-balance-value">
							{billing ? formatUsd(billing.spentThisMonthUsdMicros) : "..."}
						</span>
					</div>
				</div>
				<p className="login-disclaimer">
					The last 24 hours of data are free with any key. Older history costs
					$5 per 1M rows, taken from this balance. Credits go to this account.
				</p>
				<div className="account-packs">
					{PACKS_USD.map((usd) => (
						<button
							key={usd}
							type="button"
							className="account-pack"
							onClick={() => buyCredits(usd)}
							disabled={busy !== null}
						>
							{busy === `pack-${usd}` ? "..." : `Add $${usd}`}
						</button>
					))}
				</div>

				{error ? <p className="login-error">{error}</p> : null}

				<p className="login-disclaimer account-next">
					Endpoints: <a href="/docs/api-reference">API reference</a>.
				</p>
			</div>
		</div>
	);
}
