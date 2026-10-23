"use client";

import { CreditsCard } from "@/components/account/credits-panel";
import {
	clearAccountData,
	ensureBilling,
	ensureCaps,
	ensureUsage,
	formatUsd,
	useAccountData,
} from "@/lib/account-data";
import type { Account } from "@/lib/types";
import { currentUtcMonth, monthName, monthParam } from "@/lib/usage";
import { useAccountProblems } from "@/lib/use-account-problems";
import { refreshList } from "@/lib/webhooks-store";
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

/** Balance and this month's spend, then Dashboard, Keys and Billing, then the
 *  money and exit actions. Dashboard is the way in from product and docs pages,
 *  whose nav has no dashboard tabs. */
export function AccountMenuPanel({
	id,
	balance,
	monthLabel,
	spent,
	onNavigate,
	onCredits,
	onSignOut,
}: {
	id?: string;
	balance: string | null;
	/** The current month's name, e.g. "October". */
	monthLabel: string;
	spent: string | null;
	onNavigate?: () => void;
	onCredits?: () => void;
	onSignOut?: () => void;
}) {
	return (
		<div className="acct-panel" id={id}>
			<div className="acct-menu-rows">
				<div className="acct-menu-row muted">
					<span>Balance</span>
					<small>{balance ?? "—"}</small>
				</div>
				<div className="acct-menu-row muted">
					<span>{monthLabel}</span>
					<small>{spent ?? "—"}</small>
				</div>
				<div className="acct-menu-sep" />
				<Link href="/account" className="acct-menu-row" onClick={onNavigate}>
					Dashboard
				</Link>
				<Link
					href="/account#keys"
					className="acct-menu-row"
					onClick={onNavigate}
				>
					Keys
				</Link>
				<Link
					href="/account#usage"
					className="acct-menu-row"
					onClick={onNavigate}
				>
					Billing
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
 * Signed-in nav: a balance trigger whose menu shows balance and month spend,
 * links Keys and Billing, and opens the credits card in place.
 */
export function AccountMenu({
	account,
	onSignOut,
}: {
	account: Account;
	onSignOut: () => void;
}) {
	const { billing, service } = useAccountData();
	const problems = useAccountProblems();
	const [open, setOpen] = useState(false);
	const [card, setCard] = useState<"credits" | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	useEffect(() => {
		ensureBilling();
	}, []);

	const serviceExists = service !== null && service.state !== "none";
	useEffect(() => {
		if (!open) return;
		ensureUsage(monthParam(currentUtcMonth()));
		ensureCaps();
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

	function openCredits() {
		setOpen(false);
		setCard("credits");
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
					balance={balance}
					monthLabel={monthName(currentUtcMonth())}
					spent={billing ? formatUsd(billing.spentThisMonthUsdMicros) : null}
					onNavigate={() => setOpen(false)}
					onCredits={openCredits}
					onSignOut={() => {
						setOpen(false);
						clearAccountData();
						onSignOut();
					}}
				/>
			) : null}
			<CreditsCard
				open={card === "credits"}
				onClose={() => setCard(null)}
				email={account.email}
			/>
		</div>
	);
}
