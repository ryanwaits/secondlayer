"use client";

import { BillingScreen } from "@/components/account/billing/billing-screen";
import { type TopupReturn, takeTopupReturn } from "@/lib/account-data";
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

	return <BillingScreen ret={ret} />;
}
