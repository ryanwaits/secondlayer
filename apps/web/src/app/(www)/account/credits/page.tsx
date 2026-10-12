"use client";

import { CreditsSection } from "@/components/account/credits-panel";
import { AccountHead } from "@/components/account/parts";
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
			<AccountHead
				title="Usage and billing"
				sub={`Prepaid, no subscription. At $0 your hosted stack stops and reads past the free ${formatRows(ROWS_ALLOWANCE)} rows pause.`}
			>
				<a href="#packs" className="acct-btn solid small">
					Add credits
				</a>
			</AccountHead>
			<CreditsSection ret={ret} />
		</>
	);
}
