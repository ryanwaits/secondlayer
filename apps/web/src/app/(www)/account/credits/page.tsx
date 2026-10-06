"use client";

import { CreditsSection } from "@/components/account/credits-panel";
import { type TopupReturn, takeTopupReturn } from "@/lib/account-data";
import { ROWS_ALLOWANCE, formatRows } from "@/lib/usage";
import { useEffect, useRef, useState } from "react";

export default function AccountCreditsPage() {
	// Stripe returns here with ?topup=success|cancelled. Reading it clears
	// it, so guard against effects running twice.
	const [ret, setRet] = useState<TopupReturn | null>(null);
	const taken = useRef(false);
	useEffect(() => {
		if (taken.current) return;
		taken.current = true;
		setRet(takeTopupReturn());
	}, []);

	return (
		<>
			<h1 className="acct-h1">Credits</h1>
			<p className="acct-lede">
				Prepaid, no subscription. Usage draws from this balance as it happens.
				When it reaches $0, your hosted stack stops and reads past the free{" "}
				{formatRows(ROWS_ALLOWANCE)} rows pause until you top up.
			</p>
			<CreditsSection ret={ret} />
		</>
	);
}
