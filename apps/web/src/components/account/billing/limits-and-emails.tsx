"use client";

import { notify } from "@/components/toast/notify";
import {
	type BalanceAlerts,
	ensureAlerts,
	refreshAlerts,
	updateAlerts,
	useAccountData,
} from "@/lib/account-data";
import { dollars, parseCapInput } from "@/lib/billing-view";
import { useSave } from "@/lib/save-state";
import { useEffect, useId, useState } from "react";

const DEFAULT_ALERTS: BalanceAlerts = { notify7d: true, notify2d: true };

function AlertSwitch({
	id,
	checked,
	disabled,
	onChange,
	title,
	sub,
}: {
	id: string;
	checked: boolean;
	/** Until the stored settings have loaded, the switch shows a default, not a choice. */
	disabled: boolean;
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
						disabled={disabled}
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

const ALERT_LABEL: Record<keyof BalanceAlerts, string> = {
	notify7d: "Email me at 7 days left",
	notify2d: "Email me at 2 days left",
};

/** One balance email's switch. Optimistic: it flips at once, then goes back
 *  with a toast if the write fails. Each switch saves on its own, so one
 *  failing never undoes the other. */
function AlertRow({
	alertKey,
	id,
	sub,
	alerts,
}: {
	alertKey: keyof BalanceAlerts;
	id: string;
	sub: string;
	/** Null until the stored settings have loaded. */
	alerts: BalanceAlerts | null;
}) {
	const save = useSave<boolean>((on) => updateAlerts({ [alertKey]: on }));
	const checked = save.pending ?? (alerts ?? DEFAULT_ALERTS)[alertKey];

	async function set(next: boolean) {
		const outcome = await save.run(next);
		if (outcome === "stale") return;
		if (outcome === "failed") {
			refreshAlerts();
			notify.fail("Couldn't save that alert", { retry: () => set(next) });
			return;
		}
		notify.done(`${ALERT_LABEL[alertKey]} ${next ? "on" : "off"}`, {
			quick: true,
		});
	}

	return (
		<AlertSwitch
			id={id}
			checked={checked}
			disabled={alerts === null}
			onChange={() => set(!checked)}
			title={ALERT_LABEL[alertKey]}
			sub={sub}
		/>
	);
}

/** The account's limits: the monthly limit and the two balance emails. The
 *  switches are bound to `GET/PUT /api/billing/alerts`. */
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
		ensureAlerts();
	}, []);

	return (
		<section className="dash-panel bl-panel" aria-label="Limits and emails">
			<span className="dash-label">Limits and emails</span>
			<div className="bl-settings">
				<MonthlyLimitRow
					capUsd={capUsd}
					onCapChange={onCapChange}
					spentUsd={spentUsd}
				/>
				<AlertRow
					id="al-7"
					alertKey="notify7d"
					alerts={alerts}
					sub="Based on the last 24 hours of spend"
				/>
				<AlertRow
					id="al-2"
					alertKey="notify2d"
					alerts={alerts}
					sub="And again if the service stops"
				/>
			</div>
		</section>
	);
}
