"use client";

import { CreditsSection } from "@/components/account/credits-panel";
import { type TopupReturn, takeTopupReturn } from "@/lib/account-data";
import { useEffect, useState } from "react";

export default function AccountCreditsPage() {
	// Stripe returns here with ?topup=success|cancelled; read it once.
	const [ret, setRet] = useState<TopupReturn | null>(null);
	useEffect(() => setRet(takeTopupReturn()), []);

	return (
		<>
			<h1 className="acct-h1">Credits</h1>
			<p className="acct-lede">Pay for history older than 24 hours.</p>
			<CreditsSection ret={ret} />
		</>
	);
}
