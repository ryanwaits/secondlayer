"use client";

import { CreditsSection } from "@/components/account/credits-panel";
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

	return (
		<>
			<h1 className="acct-h1">Credits</h1>
			<p className="acct-lede">Pay for history older than 24 hours.</p>
			<CreditsSection ret={ret} />
		</>
	);
}
