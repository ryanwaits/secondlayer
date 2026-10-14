"use client";

import { CreditsCard } from "@/components/account/credits-panel";
import { KeysCard } from "@/components/account/keys-panel";
import { countByDisplayStatus } from "@/components/account/webhooks/shared";
import {
	activeKeys,
	clearAccountData,
	formatUsd,
	refreshBilling,
	refreshCaps,
	refreshKeys,
	refreshUsage,
	useAccountData,
} from "@/lib/account-data";
import { daysLeft, daysLeftLabel } from "@/lib/account-health";
import type { Account } from "@/lib/types";
import { currentUtcMonth, monthParam } from "@/lib/usage";
import { useAccountProblems } from "@/lib/use-account-problems";
import { refreshList, useWebhooksCache } from "@/lib/webhooks-store";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

/** The account's initial on a small ink square. */
export function AccountAvatar({
	account,
	size = 24,
}: {
	account: Account;
	size?: number;
}) {
	const initial = (account.displayName ?? account.email).trim()[0] ?? "?";
	return (
		<span
			className="acct-avatar"
			style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
			aria-hidden="true"
		>
			{initial.toUpperCase()}
		</span>
	);
}

/**
 * The nav trigger: initial tile, mono balance, a chevron. Pure, so the
 * healthy and alert looks render the same everywhere.
 */
export function AccountChip({
	account,
	balance,
	alert,
	open,
	menuId,
	onClick,
}: {
	account: Account;
	balance: string | null;
	alert: boolean;
	open: boolean;
	menuId?: string;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			className={`acct-chip${alert ? " alert" : ""}`}
			aria-expanded={open}
			aria-controls={menuId}
			aria-label={`Account menu, ${account.email}${balance ? `, balance ${balance}` : ""}${alert ? ", needs attention" : ""}`}
			onClick={onClick}
		>
			<AccountAvatar account={account} />
			<span className="acct-chip-balance">{balance ?? "···"}</span>
			<svg
				className="acct-chip-chev"
				width="12"
				height="12"
				viewBox="0 0 12 12"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				aria-hidden="true"
			>
				<path d="M3 4.5l3 3 3-3" />
			</svg>
		</button>
	);
}

/** The menu mirrors the side nav, so the two never disagree. */
export function AccountMenuPanel({
	id,
	email,
	caption,
	keyCount,
	spent,
	webhooks,
	onNavigate,
	onKeys,
	onCredits,
	onSignOut,
}: {
	id?: string;
	email: string;
	caption: string;
	keyCount: number | null;
	spent: string | null;
	/** "7 of 7", or null when the webhooks list hasn't loaded. */
	webhooks: string | null;
	onNavigate?: () => void;
	onKeys?: () => void;
	onCredits?: () => void;
	onSignOut?: () => void;
}) {
	return (
		<div className="acct-panel" id={id}>
			<div className="acct-menu-top">
				<b>{email}</b>
				<span>{caption}</span>
			</div>
			<div className="acct-menu-rows">
				<Link href="/account" className="acct-menu-row" onClick={onNavigate}>
					<span>Open account</span>
					<span className="acct-menu-go" aria-hidden="true">
						→
					</span>
				</Link>
				<button type="button" className="acct-menu-row" onClick={onKeys}>
					<span>API keys</span>
					<small>{keyCount ?? "—"}</small>
				</button>
				<Link
					href="/account/credits"
					className="acct-menu-row"
					onClick={onNavigate}
				>
					<span>Usage and billing</span>
					<small>{spent ?? "—"}</small>
				</Link>
				<Link
					href="/account/webhooks"
					className="acct-menu-row"
					onClick={onNavigate}
				>
					<span>Webhooks</span>
					<small>{webhooks ?? "—"}</small>
				</Link>
			</div>
			<div className="acct-menu-foot">
				<button type="button" className="acct-menu-credits" onClick={onCredits}>
					Add credits
				</button>
				<button type="button" className="acct-menu-signout" onClick={onSignOut}>
					Sign out
				</button>
			</div>
		</div>
	);
}

/**
 * Signed-in nav: a balance trigger whose menu leads to the account Overview and
 * opens the keys and credits cards in place.
 */
export function AccountMenu({
	account,
	onSignOut,
}: {
	account: Account;
	onSignOut: () => void;
}) {
	const { billing, keys, burn, service } = useAccountData();
	const { list } = useWebhooksCache();
	const problems = useAccountProblems();
	const [open, setOpen] = useState(false);
	const [card, setCard] = useState<"keys" | "credits" | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	useEffect(() => {
		refreshBilling();
	}, []);

	const serviceExists = service !== null && service.state !== "none";
	useEffect(() => {
		if (!open) return;
		refreshKeys();
		refreshUsage(monthParam(currentUtcMonth()));
		refreshCaps();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		const onClick = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("click", onClick);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("click", onClick);
		};
	}, [open]);

	// Listing webhooks goes through the account's hosted stack; only ask once
	// we know one exists, so opening the menu never starts one.
	useEffect(() => {
		if (open && serviceExists) refreshList();
	}, [open, serviceExists]);

	const balance = billing ? formatUsd(billing.creditsUsdMicros) : null;
	const days = daysLeftLabel(daysLeft(billing, burn));
	const rows = list?.data ?? null;
	const delivering = rows
		? rows.length - countByDisplayStatus(rows, "error")
		: 0;

	function openCard(which: "keys" | "credits") {
		setOpen(false);
		setCard(which);
	}

	return (
		<div className="acct-menu" ref={rootRef}>
			<AccountChip
				account={account}
				balance={balance}
				alert={problems.length > 0}
				open={open}
				menuId={menuId}
				onClick={() => setOpen((v) => !v)}
			/>
			{open ? (
				<AccountMenuPanel
					id={menuId}
					email={account.email}
					caption={["hosted", days && `${days} left`]
						.filter(Boolean)
						.join(" · ")}
					keyCount={keys === null ? null : activeKeys(keys).length}
					spent={billing ? formatUsd(billing.spentThisMonthUsdMicros) : null}
					webhooks={rows ? `${delivering} of ${rows.length}` : null}
					onNavigate={() => setOpen(false)}
					onKeys={() => openCard("keys")}
					onCredits={() => openCard("credits")}
					onSignOut={() => {
						setOpen(false);
						clearAccountData();
						onSignOut();
					}}
				/>
			) : null}
			<KeysCard open={card === "keys"} onClose={() => setCard(null)} />
			<CreditsCard
				open={card === "credits"}
				onClose={() => setCard(null)}
				email={account.email}
			/>
		</div>
	);
}
