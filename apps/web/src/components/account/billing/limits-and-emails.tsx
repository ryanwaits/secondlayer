"use client";

import {
	type BalanceAlerts,
	refreshAlerts,
	updateAlerts,
	useAccountData,
} from "@/lib/account-data";
import { dollars, parseCapInput } from "@/lib/billing-view";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

const DEFAULT_ALERTS: BalanceAlerts = { notify7d: true, notify2d: true };

function AlertSwitch({
	id,
	checked,
	onChange,
	title,
	sub,
}: {
	id: string;
	checked: boolean;
	onChange: () => void;
	title: string;
	sub: string;
}) {
	return (
		<div className="bl-set-row">
			<label htmlFor={id}>
				<span className="t">{title}</span>
				<span className="s">{sub}</span>
			</label>
			<span className="bl-switch-slot">
				<span className="use-switch">
					<input
						type="checkbox"
						id={id}
						checked={checked}
						onChange={onChange}
					/>
					<span />
				</span>
			</span>
		</div>
	);
}

/** What the limit box keeps of what was typed: digits only, so a stray letter
 *  can never read as "empty" and clear the limit. */
export function limitDigits(raw: string): string {
	return raw.replace(/\D/g, "");
}

/** The monthly limit: one field, empty means no limit. Commits on blur or
 *  Enter; an empty box clears the limit. */
export function MonthlyLimitRow({
	capUsd,
	onCapChange,
	spentUsd,
}: {
	capUsd: number | null;
	onCapChange: (next: number | null) => void;
	/** This month's spend in dollars, for the limit's line. */
	spentUsd: number;
}) {
	const id = useId();
	const [draft, setDraft] = useState<string | null>(null);

	function commit() {
		const typed = draft;
		setDraft(null);
		if (typed === null) return;
		const next = parseCapInput(typed);
		if (next !== capUsd) onCapChange(next);
	}

	return (
		<div className="bl-set-row">
			<label htmlFor={id}>
				<span className="t">Monthly limit</span>
				<span className="s">
					{capUsd == null
						? "None set. Your balance is the only ceiling."
						: `Everything pauses past $${capUsd.toLocaleString("en-US")} in a month, webhooks included. ${dollars(spentUsd)} so far this month.`}
				</span>
			</label>
			<label className="bl-field">
				$
				<input
					id={id}
					type="text"
					inputMode="numeric"
					autoComplete="off"
					placeholder="No limit"
					value={draft ?? capUsd ?? ""}
					onChange={(e) => setDraft(limitDigits(e.target.value))}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						}
					}}
				/>
			</label>
		</div>
	);
}

/** The account's limits: the monthly limit and the two balance emails. The
 *  switches are bound to `GET/PUT /api/billing/alerts`. Optimistic: the
 *  switch flips immediately, then reverts with a Sonner toast if the write
 *  fails. */
export function LimitsAndEmails({
	capUsd,
	onCapChange,
	spentUsd,
}: {
	capUsd: number | null;
	onCapChange: (next: number | null) => void;
	spentUsd: number;
}) {
	const { alerts } = useAccountData();
	useEffect(() => {
		refreshAlerts();
	}, []);
	const [pending, setPending] = useState<BalanceAlerts | null>(null);
	const current = pending ?? alerts ?? DEFAULT_ALERTS;

	async function toggle(key: keyof BalanceAlerts) {
		const next = { ...current, [key]: !current[key] };
		setPending(next);
		const result = await updateAlerts({ [key]: next[key] });
		setPending(null);
		if (!result) toast.error("Couldn't update that alert");
	}

	return (
		<section className="dash-panel bl-panel" aria-label="Limits and emails">
			<span className="dash-label">Limits and emails</span>
			<div className="bl-settings">
				<MonthlyLimitRow
					capUsd={capUsd}
					onCapChange={onCapChange}
					spentUsd={spentUsd}
				/>
				<AlertSwitch
					id="al-7"
					checked={current.notify7d}
					onChange={() => toggle("notify7d")}
					title="Email me at 7 days left"
					sub="Based on the last 24 hours of spend"
				/>
				<AlertSwitch
					id="al-2"
					checked={current.notify2d}
					onChange={() => toggle("notify2d")}
					title="Email me at 2 days left"
					sub="And again if the service stops"
				/>
			</div>
		</section>
	);
}
