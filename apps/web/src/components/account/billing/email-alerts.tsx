"use client";

import {
	type BalanceAlerts,
	refreshAlerts,
	updateAlerts,
	useAccountData,
} from "@/lib/account-data";
import { useEffect, useState } from "react";
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
		<div className="use-alert-row">
			<label htmlFor={id}>
				<span className="t">{title}</span>
				<span className="s">{sub}</span>
			</label>
			<span className="use-switch">
				<input type="checkbox" id={id} checked={checked} onChange={onChange} />
				<span />
			</span>
		</div>
	);
}

/** Two switches, bound to `GET/PUT /api/billing/alerts`. Optimistic: the
 *  switch flips immediately, then reverts with a Sonner toast if the write
 *  fails. */
export function EmailAlerts() {
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
		<section className="dash-panel bl-panel" aria-label="Emails">
			<span className="dash-label">Emails</span>
			<div className="use-alerts">
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
